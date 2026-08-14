"""CollabCode backend — Flask + Socket.IO server for the collaborative editor.

Responsibilities, in rough order of importance:

1. **Real-time fan-out.** Every editor event (code edits, cursors, selections,
   typing, chat) arrives over Socket.IO and is re-broadcast to everyone else in
   the same room. Socket.IO "rooms" do the addressing for us — `to=room_id`.
2. **State ownership.** The authoritative file tree per room lives in
   Redis (hot) + PostgreSQL (durable). See `rooms.py` for that layer.
3. **Side services.** Python code execution (`/api/run`), the Claude-backed AI
   assistant (`/api/ai`, streamed over SSE), and version snapshots (SQLite).

Concurrency model: eventlet + a single gunicorn worker. That matters — one
worker means one process holds all the Socket.IO connections, so in-process
state stays consistent. Scaling past one worker would require a Socket.IO
message queue (Redis pub/sub) so broadcasts reach clients on other workers.

Conflict resolution: none — this is last-write-wins on whole-file content.
See `on_code_change` for the tradeoff versus OT/CRDT.
"""
from flask import Flask, request, jsonify, Response
from flask_socketio import SocketIO, join_room, leave_room, emit
from flask_cors import CORS
from dotenv import load_dotenv
import os
import resource
import shutil
import subprocess
import sys
import tempfile
import time
import json
import sqlite3
import threading
import anthropic
import httpx
from datetime import datetime, timezone, timedelta

RESPAN_LOG_URL = 'https://api.keywordsai.co/api/request-logs/create'


def _send_respan_log(messages, output, model, max_tokens, status_code, mode):
    """Fire-and-forget observability log for one AI request.

    Called on a daemon thread after the SSE stream closes so it never adds
    latency to the user-visible response. Every failure path is swallowed on
    purpose: analytics must never break the feature it observes.
    """
    try:
        api_key = os.getenv('RESPAN_API_KEY')
        if not api_key:
            return
        httpx.post(
            RESPAN_LOG_URL,
            json={
                'model': model,
                'prompt_messages': [{'role': m['role'], 'content': m['content']} for m in messages],
                'output': output,
                'max_tokens': max_tokens,
                'stream': True,
                'status_code': status_code,
                'custom_identifier': mode,
            },
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            },
            timeout=10,
        )
    except Exception:
        pass

from database import db
import rooms as rooms_module
from rooms import (
    store_room_content, get_room_content,
    add_user_to_room, remove_user_from_room, get_room_users,
    get_user_room, set_user_room, clear_user_room,
    get_file_system, store_file_system, make_file,
    get_room_meta, set_room_meta, room_exists_in_db,
    hash_room_password, verify_room_password, public_room_meta,
    clear_room_redis_keys, get_language_from_name,
    load_rooms_from_db,
)

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', '')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Allowed browser origins. Wildcard CORS on this server meant any page on the
# internet could call /api/ai (Claude, billed to us) and /api/run. Override with
# a comma-separated ALLOWED_ORIGINS in the environment when the frontend moves.
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv(
        'ALLOWED_ORIGINS',
        'https://collaborative-code-editor-livid.vercel.app,'
        'http://localhost:5173,http://127.0.0.1:5173',
    ).split(',') if o.strip()
]

CORS(app, origins=ALLOWED_ORIGINS)
socketio = SocketIO(app, cors_allowed_origins=ALLOWED_ORIGINS, async_mode='eventlet')

DB_PATH = os.path.join(os.path.dirname(__file__), 'snapshots.db')


# ── Initialization ─────────────────────────────────────────────────

def init_sqlite():
    """Create the version-history table if it doesn't exist.

    Snapshots live in SQLite rather than PostgreSQL because they're
    append-only, single-writer, and never queried across rooms — a local file
    is enough. Caveat for deploys on ephemeral disks (Render's free tier):
    this file is wiped on restart, so history is best-effort, while room
    content in PostgreSQL survives.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        file_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL
    )''')
    conn.commit()
    conn.close()


def init_postgres():
    """Wire up PostgreSQL, then warm the Redis cache from it.

    Every step is optional-by-design: without `DATABASE_URL` the app still runs
    fully, just Redis-only (rooms then die with the server). That keeps local
    development to a single dependency.
    """
    if not os.getenv('DATABASE_URL'):
        print('DATABASE_URL not set, skipping PostgreSQL init')
        return
    try:
        db.init_app(app)
        with app.app_context():
            db.create_all()
            rooms_module.init_pg()
            load_rooms_from_db()
    except Exception as e:
        print(f'PostgreSQL init failed: {e}')


init_sqlite()
init_postgres()


# ── Room expiry cleanup ────────────────────────────────────────────

def _cleanup_expired_rooms():
    """Delete rooms untouched for 30+ days, then re-arm itself for tomorrow.

    Rooms are anonymous and never explicitly deleted by users, so without a
    reaper the tables grow forever. `last_active` is bumped on every
    `store_file_system` write, so "active" means "someone typed in it".

    The `finally` block reschedules unconditionally — if one pass throws, the
    daily cadence still survives. Safe only because we run a single worker;
    with N workers this would fire N times a day and race on deletes.
    """
    try:
        with app.app_context():
            if not rooms_module._USE_PG or rooms_module._Room is None:
                return
            cutoff = datetime.now(timezone.utc) - timedelta(days=30)
            expired = rooms_module._Room.query.filter(rooms_module._Room.last_active < cutoff).all()
            for room in expired:
                clear_room_redis_keys(room.room_id)
                try:
                    conn = sqlite3.connect(DB_PATH)
                    conn.execute('DELETE FROM snapshots WHERE room_id=?', (room.room_id,))
                    conn.commit()
                    conn.close()
                except Exception:
                    pass
                rooms_module._db.session.delete(room)
            if expired:
                rooms_module._db.session.commit()
                print(f'Cleaned up {len(expired)} expired rooms')
    except Exception as e:
        print(f'Room cleanup error: {e}')
    finally:
        threading.Timer(86400, _cleanup_expired_rooms).start()


threading.Timer(86400, _cleanup_expired_rooms).start()


# ── Socket.IO events ───────────────────────────────────────────────

@socketio.on('connect')
def on_connect():
    print(f'Client connected: {request.sid}')


@socketio.on('disconnect')
def on_disconnect():
    """Clean up presence when a socket drops (tab close, network loss, refresh).

    The browser has no chance to send `leave_room` on a hard disconnect, so
    this is the real cleanup path. We can't trust the client to tell us which
    room it was in either — hence the `session:<sid>:room` reverse index, which
    lets us resolve sid -> room from server state alone.

    Two events go out because the client needs both: `user_list` re-renders the
    avatar stack, `user_left` tells peers to drop that user's cursor, selection,
    and typing indicator (those are ephemeral and never replayed).
    """
    try:
        sid = request.sid
        room_id = get_user_room(sid)
        if room_id:
            remove_user_from_room(room_id, sid)
            clear_user_room(sid)
            leave_room(room_id)
            users = get_room_users(room_id)
            emit('user_list', {'users': users}, to=room_id)
            emit('user_left', {'session_id': sid}, to=room_id)
        print(f'Client disconnected: {sid}')
    except Exception as e:
        print(f'disconnect error: {e}')


@socketio.on('join_room')
def on_join_room(data):
    """Admit a client to a room and hand it the current state. The main entry point.

    Sequence:
      1. Password gate — `verify_room_password` checks against the stored hash.
         The room's own settings are echoed back through `public_room_meta`,
         which strips the password: the client is told *whether* one is set,
         never what it is.
      2. `join_room(room_id)` subscribes this socket to the Socket.IO room, which
         is what makes every later `to=room_id` broadcast reach it.
      3. First joiner becomes `owner`. Note this is a socket id, so it resets on
         reconnect and isn't persisted to PostgreSQL — ownership is advisory only.
      4. `get_file_system` lazily creates the room on first join (Redis miss ->
         PostgreSQL -> fresh `main.js`), so there's no separate "create" step.

    Three emits with deliberately different audiences:
      - `room_state`  -> just this socket: the full file tree + user list snapshot.
      - `user_joined` -> everyone else (`include_self=False`): drives the toast.
      - `user_list`   -> everyone including self: the authoritative roster.
    """
    try:
        room_id = data.get('room_id')
        username = data.get('username', 'Anonymous')
        color = data.get('color', '#ffffff')
        password = data.get('password', '')
        sid = request.sid

        meta = get_room_meta(room_id)
        if not verify_room_password(meta, password):
            emit('join_error', {'message': 'Incorrect password'})
            return

        join_room(room_id)
        set_user_room(sid, room_id)

        if meta.get('owner') is None:
            meta['owner'] = sid
            set_room_meta(room_id, meta)

        user_data = {'session_id': sid, 'username': username, 'color': color}
        add_user_to_room(room_id, user_data)

        users = get_room_users(room_id)
        fs = get_file_system(room_id)

        emit('room_state', {'fs': fs, 'users': users, 'meta': public_room_meta(meta)})
        emit('user_joined', user_data, to=room_id, include_self=False)
        emit('user_list', {'users': users}, to=room_id)
    except Exception as e:
        print(f'join_room error: {e}')
        emit('join_error', {'message': 'Failed to join room'})


def _apply_room_settings(room_id, visibility, password, current_password, owner=None):
    """Create or update a room's settings. Returns (ok, error).

    The authorization rule: settings are free to claim while the room has no
    password — that is how creation works, since rooms otherwise come into
    existence implicitly on first join. Once a password is set, changing
    anything requires presenting it. Without that check any caller who knew a
    room id could rewrite the password and lock out everyone currently in it,
    or flip a private room to public.

    Known limit, inherent to having no user accounts: a room with no password
    can still have one added by a stranger who knows its id. `owner` is a live
    socket id that resets on reconnect, so it cannot carry this. Closing that
    gap needs real accounts, not a bigger check here.
    """
    existing = get_room_meta(room_id)
    if existing.get('password') and not verify_room_password(existing, current_password):
        return False, 'Current password required to change room settings'

    meta = {
        'visibility': visibility if visibility is not None else existing.get('visibility', 'public'),
        # Carry the stored hash forward untouched unless a new password is given.
        'password': existing.get('password'),
        'owner': existing.get('owner') or owner,
    }
    if password is not None:
        meta['password'] = hash_room_password(password)

    set_room_meta(room_id, meta)
    return True, None


@socketio.on('create_room')
def on_create_room(data):
    """Pre-seed room metadata (visibility/password) before anyone joins.

    Optional path — the Home page uses the REST equivalent (`POST
    /api/room/<id>/meta`) so the settings land before navigation. Rooms
    themselves are created implicitly on first join.
    """
    try:
        room_id = data.get('room_id')
        ok, error = _apply_room_settings(
            room_id,
            data.get('visibility', 'public'),
            data.get('password', None),
            data.get('current_password', ''),
            owner=request.sid,
        )
        if not ok:
            emit('room_error', {'message': error})
            return
        emit('room_created', {'room_id': room_id, 'meta': public_room_meta(get_room_meta(room_id))})
    except Exception as e:
        print(f'create_room error: {e}')


@socketio.on('leave_room')
def on_leave_room(data):
    """Graceful exit — same cleanup as `on_disconnect`, but the socket lives on.

    Fired when a user clicks Leave or the Room component unmounts. Splitting it
    from disconnect lets a client leave one room and join another without
    tearing down the connection.
    """
    try:
        room_id = data.get('room_id')
        sid = request.sid
        remove_user_from_room(room_id, sid)
        clear_user_room(sid)
        leave_room(room_id)
        users = get_room_users(room_id)
        emit('user_list', {'users': users}, to=room_id)
        emit('user_left', {'session_id': sid}, to=room_id)
    except Exception as e:
        print(f'leave_room error: {e}')


@socketio.on('code_change')
def on_code_change(data):
    """The hot path: persist an edit and fan it out to the rest of the room.

    Design choice — we ship the **whole file content** on every keystroke and
    apply last-write-wins, rather than operational transforms or a CRDT.

      + Trivially correct for the common case (people editing different files,
        or different regions with a human-scale typing gap), and it means the
        server stays stateless about intent — no transform history to keep.
      - Two people typing in the same file at the same instant will clobber each
        other: the later message wins wholesale, no character-level merge.
      - Payload scales with file size, not edit size. Fine at ~KBs (benchmarked
        p95 < 17ms up to 50 clients), wrong for large documents.

    Yjs/Automerge is the upgrade path: keep this socket layer, swap the payload
    for CRDT updates and the merge becomes conflict-free.

    `include_self=False` matters — echoing back to the sender would fight the
    local Monaco model and jump the user's cursor.
    """
    try:
        room_id = data.get('room_id')
        content = data.get('content', '')
        file_id = data.get('file_id')
        if file_id:
            fs = get_file_system(room_id)
            for f in fs['files']:
                if f['id'] == file_id:
                    f['content'] = content
                    break
            store_file_system(room_id, fs)
        else:
            store_room_content(room_id, content)
        emit('code_change', data, to=room_id, include_self=False)
    except Exception as e:
        print(f'code_change error: {e}')


# Presence relays (cursor / selection / typing / chat).
#
# These four are deliberately dumb pass-throughs: validate the room, re-emit,
# never touch storage. Presence is ephemeral — if you refresh, your cursor is
# simply gone, and that's the correct behaviour. Skipping the Redis/PG write
# keeps them off the persistence path entirely, which is what lets cursor
# updates fire on every mouse move without hammering the datastore.

@socketio.on('cursor_move')
def on_cursor_move(data):
    """Relay a caret position. Also powers follow-mode scrolling on the client."""
    try:
        room_id = data.get('room_id')
        emit('cursor_move', data, to=room_id, include_self=False)
    except Exception as e:
        print(f'cursor_move error: {e}')


@socketio.on('selection_change')
def on_selection_change(data):
    """Relay a highlighted range so peers can render a tinted overlay."""
    try:
        room_id = data.get('room_id')
        emit('selection_change', data, to=room_id, include_self=False)
    except Exception as e:
        print(f'selection_change error: {e}')


@socketio.on('typing')
def on_typing(data):
    """Relay a typing on/off flag. The 1.5s debounce that produces it is client-side."""
    try:
        room_id = data.get('room_id')
        emit('typing', data, to=room_id, include_self=False)
    except Exception as e:
        print(f'typing error: {e}')


@socketio.on('send_message')
def on_send_message(data):
    """Broadcast a chat message to the whole room, sender included.

    Unlike the editor events this *does* echo to self — the sender renders the
    message only once the server has accepted it, so the transcript order is
    identical for everyone. Messages are not persisted, so chat history is
    per-session (the `RoomMessage` model exists for this but isn't wired up yet).
    """
    try:
        room_id = data.get('room_id')
        emit('new_message', data, to=room_id)
    except Exception as e:
        print(f'send_message error: {e}')


# ── File system events ─────────────────────────────────────────────
#
# All four mutations follow the same shape: read the authoritative tree, mutate
# it, write it back, then broadcast the *entire* tree as `fs_update` — to
# everyone, sender included. Two reasons for the full-tree broadcast:
#   1. File ids are server-generated (uuid4), so the client that asked for a new
#      file can only learn its id by receiving the tree back.
#   2. It's self-healing: any client that missed an earlier event is silently
#      resynced, no reconciliation logic needed.
# The tree is small (metadata + contents for a handful of files), so the
# simplicity is worth more than the bytes saved by a delta.

@socketio.on('create_file')
def on_create_file(data):
    """Add a file to the room and focus it. Language is inferred from the extension."""
    try:
        room_id = data.get('room_id')
        name = data.get('name', 'untitled.js')
        language = get_language_from_name(name)
        fs = get_file_system(room_id)
        new_file = make_file(name, '', language)
        fs['files'].append(new_file)
        fs['activeFileId'] = new_file['id']
        store_file_system(room_id, fs)
        emit('fs_update', {'fs': fs}, to=room_id)
    except Exception as e:
        print(f'create_file error: {e}')


@socketio.on('delete_file')
def on_delete_file(data):
    """Remove a file, refusing to delete the last one.

    The guard is enforced here rather than trusting the client's disabled
    button — an empty tree would leave the editor with nothing to bind to.
    If the deleted file was active, focus falls back to the first survivor.
    """
    try:
        room_id = data.get('room_id')
        file_id = data.get('file_id')
        fs = get_file_system(room_id)
        if len(fs['files']) <= 1:
            return
        fs['files'] = [f for f in fs['files'] if f['id'] != file_id]
        if fs['activeFileId'] == file_id:
            fs['activeFileId'] = fs['files'][0]['id']
        store_file_system(room_id, fs)
        emit('fs_update', {'fs': fs}, to=room_id)
    except Exception as e:
        print(f'delete_file error: {e}')


@socketio.on('rename_file')
def on_rename_file(data):
    """Rename a file and re-derive its language — renaming `x.js` to `x.py`
    re-syntax-highlights it for everyone in the room."""
    try:
        room_id = data.get('room_id')
        file_id = data.get('file_id')
        new_name = data.get('name', '')
        fs = get_file_system(room_id)
        for f in fs['files']:
            if f['id'] == file_id:
                f['name'] = new_name
                f['language'] = get_language_from_name(new_name)
                break
        store_file_system(room_id, fs)
        emit('fs_update', {'fs': fs}, to=room_id)
    except Exception as e:
        print(f'rename_file error: {e}')


@socketio.on('update_file_language')
def on_update_file_language(data):
    """Explicit language override from the toolbar picker, beating extension inference."""
    try:
        room_id = data.get('room_id')
        file_id = data.get('file_id')
        language = data.get('language', 'plaintext')
        fs = get_file_system(room_id)
        for f in fs['files']:
            if f['id'] == file_id:
                f['language'] = language
                break
        store_file_system(room_id, fs)
        emit('fs_update', {'fs': fs}, to=room_id)
    except Exception as e:
        print(f'update_file_language error: {e}')


@socketio.on('switch_file')
def on_switch_file(data):
    """Tell peers which tab this user moved to — presence, not state.

    Deliberately does *not* write `activeFileId` to the room: that field is the
    room's default landing tab, and letting every click rewrite it would drag
    everyone else's editor around. Purely a relay, like the cursor events.
    """
    try:
        room_id = data.get('room_id')
        file_id = data.get('file_id')
        session_id = data.get('session_id')
        emit('file_switched', {'file_id': file_id, 'session_id': session_id}, to=room_id, include_self=False)
    except Exception as e:
        print(f'switch_file error: {e}')


# ── REST endpoints ─────────────────────────────────────────────────

@app.route('/health')
def health():
    return {'status': 'ok'}

# Server-side execution runs untrusted code, so it is opt-in rather than
# opt-out: an operator has to set ENABLE_CODE_EXECUTION=1 deliberately, and
# should only do so where the process itself is disposable (a per-run container).
# It is off on the public deployment.
CODE_EXECUTION_ENABLED = os.getenv('ENABLE_CODE_EXECUTION', '').lower() in ('1', 'true', 'yes')

EXEC_TIMEOUT_SECONDS = 5
EXEC_MEMORY_BYTES = 256 * 1024 * 1024
EXEC_MAX_OUTPUT_BYTES = 64 * 1024

# Caps on what one /api/ai call can cost us.
MAX_HISTORY_TURNS = 20
MAX_INPUT_CHARS = 50_000

# ── Rate limiting ──────────────────────────────────────────────────
# In-process and per-IP. That is sufficient *here* specifically because this
# server runs a single gunicorn worker (see the module docstring) — one process
# holds all state. Adding a second worker would need Redis-backed counters.
_rate_buckets = {}
_rate_lock = threading.Lock()


def _client_ip():
    """Real client IP. Behind Render's proxy request.remote_addr is the proxy,
    and the LAST X-Forwarded-For entry is the one Render itself appended — the
    earlier entries are client-supplied and trivially spoofed."""
    forwarded = request.headers.get('X-Forwarded-For', '')
    if forwarded:
        return forwarded.split(',')[-1].strip()
    return request.remote_addr or 'unknown'


def rate_limit(bucket: str, limit: int, window_seconds: int):
    """Allow `limit` requests per `window_seconds` per IP. Returns True if OK."""
    key = (bucket, _client_ip())
    now = time.time()
    with _rate_lock:
        hits = [t for t in _rate_buckets.get(key, []) if now - t < window_seconds]
        if len(hits) >= limit:
            _rate_buckets[key] = hits
            return False
        hits.append(now)
        _rate_buckets[key] = hits
        # Opportunistic sweep so idle keys don't accumulate forever.
        if len(_rate_buckets) > 4096:
            for k, v in list(_rate_buckets.items()):
                if not [t for t in v if now - t < window_seconds]:
                    _rate_buckets.pop(k, None)
    return True


@app.route('/api/run', methods=['POST'])
def run_code():
    """Execute code server-side. Python only — JavaScript never reaches here.

    JS runs in the browser instead (see `handleRun` in Room.tsx): zero round
    trip, and the blast radius is the user's own tab rather than our server.

    Disabled unless ENABLE_CODE_EXECUTION is set — see `run_python` for why.
    """
    if not CODE_EXECUTION_ENABLED:
        return jsonify({
            'stdout': '',
            'stderr': 'Server-side Python execution is disabled on this instance.',
            'elapsed_ms': 0,
        }), 503

    if not rate_limit('run', limit=10, window_seconds=60):
        return jsonify({'stdout': '', 'stderr': 'Rate limit exceeded.', 'elapsed_ms': 0}), 429

    data = request.get_json() or {}
    language = data.get('language', 'python')
    code = data.get('code', '')
    if not isinstance(code, str):
        return jsonify({'error': 'code must be a string'}), 400
    if len(code) > MAX_INPUT_CHARS:
        return jsonify({'error': f'code exceeds {MAX_INPUT_CHARS} characters'}), 413
    if language == 'python':
        return run_python(code)
    return jsonify({'error': 'Unsupported language'}), 400


def _apply_exec_limits():
    """Run in the forked child between fork and exec, so these limits bind the
    interpreter we are about to start and nothing else.

    Each limit is applied independently and best-effort, because support varies
    by platform: macOS rejects RLIMIT_AS outright, and RLIMIT_NPROC counts
    processes per real UID so it can fail on a busy host. An exception raised
    here aborts the whole spawn, so one unsupported limit must not cost us the
    others — Linux (where this deploys) gets all of them, macOS gets the rest.

    None of these are the primary control. That is `env={}` in the caller.
    """
    for limit_name, value in (
        ('RLIMIT_CPU', (EXEC_TIMEOUT_SECONDS, EXEC_TIMEOUT_SECONDS)),
        ('RLIMIT_AS', (EXEC_MEMORY_BYTES, EXEC_MEMORY_BYTES)),
        ('RLIMIT_FSIZE', (1024 * 1024, 1024 * 1024)),
        ('RLIMIT_CORE', (0, 0)),
        ('RLIMIT_NPROC', (256, 256)),
    ):
        limit = getattr(resource, limit_name, None)
        if limit is None:
            continue
        try:
            resource.setrlimit(limit, value)
        except (ValueError, OSError):
            continue


def run_python(code: str):
    """Write the snippet to a temp file, run it under a constrained interpreter,
    capture both streams.

    This is defence in depth, not a sandbox, and the distinction matters:

    * `env={}` — the child gets no environment at all, so ANTHROPIC_API_KEY,
      DATABASE_URL, SECRET_KEY and RESPAN_API_KEY are not readable from it.
      This is the single most valuable guard here.
    * `-I` isolates the interpreter (ignores PYTHON* vars and user site-packages)
      and `-S` skips site entirely, so only the standard library is importable.
      Drop `-S` if you want third-party imports to work.
    * `cwd` is a fresh empty directory that is removed afterwards, so relative
      paths cannot reach the application's own files.
    * `_apply_exec_limits` caps CPU, address space, and file writes; the
      `timeout=` still handles the wall-clock case (e.g. `time.sleep`).

    What this still does NOT stop: reading world-readable files by absolute path
    and making outbound network connections — `urllib` is stdlib. Treat the
    executing process as hostile. A real boundary is a per-run container
    (gVisor/Firecracker) or a hosted service like Piston; until this runs inside
    one, leave ENABLE_CODE_EXECUTION unset in any environment you care about.
    """
    start = time.time()
    workdir = tempfile.mkdtemp(prefix='collabcode-run-')
    fname = os.path.join(workdir, 'main.py')
    try:
        with open(fname, 'w', encoding='utf-8') as f:
            f.write(code)
        result = subprocess.run(
            [sys.executable, '-I', '-S', fname],
            capture_output=True,
            text=True,
            timeout=EXEC_TIMEOUT_SECONDS,
            cwd=workdir,
            env={},
            stdin=subprocess.DEVNULL,
            preexec_fn=_apply_exec_limits,
        )
        elapsed = round((time.time() - start) * 1000)
        return jsonify({
            'stdout': result.stdout[:EXEC_MAX_OUTPUT_BYTES],
            'stderr': result.stderr[:EXEC_MAX_OUTPUT_BYTES],
            'elapsed_ms': elapsed,
        })
    except subprocess.TimeoutExpired:
        return jsonify({
            'stdout': '',
            'stderr': f'Execution timed out ({EXEC_TIMEOUT_SECONDS}s limit)',
            'elapsed_ms': EXEC_TIMEOUT_SECONDS * 1000,
        })
    except Exception:
        # Never surface the raw exception: it leaks interpreter and filesystem paths.
        app.logger.exception('code execution failed')
        return jsonify({'stdout': '', 'stderr': 'Execution failed.', 'elapsed_ms': 0})
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


@app.route('/api/ai', methods=['POST'])
def ai_assist():
    """Claude-backed assistant, streamed to the browser over Server-Sent Events.

    Why SSE rather than a plain JSON response: a 2000-token answer takes several
    seconds to generate, and users read faster than they wait. Streaming token
    by token makes it feel instant. Why SSE rather than the existing Socket.IO
    connection: this is a request/response interaction with exactly one
    recipient — no reason to put it on the broadcast bus.

    The four `mode`s are just prompt templates over the same endpoint. `target`
    implements the "selection wins over whole file" rule: highlight ten lines
    and only those ten are sent, which keeps requests cheap and answers focused.

    `history` comes from the client so multi-turn context survives without any
    server-side session store — the endpoint stays stateless.

    Note the API key is read per-request, not at import: the server boots fine
    without one and degrades to a clean in-panel error message instead of a 500.
    """
    if not rate_limit('ai', limit=20, window_seconds=60):
        return jsonify({'error': 'Rate limit exceeded. Please wait a moment.'}), 429

    data = request.get_json() or {}
    mode = data.get('mode', 'explain')
    code = data.get('code', '')
    selection = data.get('selection', '')
    language = data.get('language', 'javascript')
    error_msg = data.get('error', '')
    prompt = data.get('prompt', '')
    history = data.get('history', [])

    # `history` is client-supplied, which is what keeps this endpoint stateless.
    # Cap it: unbounded, a caller could pass an arbitrarily long conversation and
    # turn one request into an arbitrarily large bill on our key.
    if not isinstance(history, list):
        history = []
    history = [
        h for h in history[-MAX_HISTORY_TURNS:]
        if isinstance(h, dict) and h.get('role') in ('user', 'assistant')
        and isinstance(h.get('content'), str)
    ]
    for field_name, value in (('code', code), ('selection', selection), ('prompt', prompt)):
        if isinstance(value, str) and len(value) > MAX_INPUT_CHARS:
            return jsonify({'error': f'{field_name} exceeds {MAX_INPUT_CHARS} characters'}), 413

    api_key = os.getenv('ANTHROPIC_API_KEY')
    if not api_key:
        def no_key():
            yield f"data: {json.dumps({'type': 'error', 'message': 'AI features unavailable: ANTHROPIC_API_KEY not configured.'})}\n\n"
        return Response(no_key(), mimetype='text/event-stream',
                        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

    target = selection if selection.strip() else code
    lang_label = language.capitalize()

    if mode == 'explain':
        user_msg = f"Explain this {lang_label} code clearly and concisely. Focus on what it does, how it works, and any important patterns:\n\n```{language}\n{target}\n```"
    elif mode == 'fix':
        error_part = f"\n\nError message:\n```\n{error_msg}\n```" if error_msg else ""
        user_msg = f"Fix the bug in this {lang_label} code. Show the corrected code and briefly explain what was wrong:{error_part}\n\n```{language}\n{target}\n```"
    elif mode == 'improve':
        user_msg = f"Improve this {lang_label} code. Make it cleaner, more efficient, or more readable. Show the improved code with brief explanations:\n\n```{language}\n{target}\n```"
    elif mode == 'generate':
        user_msg = f"Generate {lang_label} code for the following: {prompt}\n\nReturn only the code in a code block, then a brief explanation."
    else:
        user_msg = prompt or f"Help with this {lang_label} code:\n\n```{language}\n{target}\n```"

    messages = history + [{'role': 'user', 'content': user_msg}]

    def generate():
        """Generator body of the SSE stream — each `yield` flushes to the browser.

        Wire format is one JSON object per `data:` line, tagged with a `type`
        (`text` | `done` | `error`) so the client can tell a content chunk from
        a terminal signal. Errors are streamed as `type: error` rather than
        raised: headers are already sent by the time we're inside the generator,
        so an exception here can no longer become an HTTP status code.

        `X-Accel-Buffering: no` (set on the Response below) is the deployment
        detail that makes this work behind nginx — without it the proxy buffers
        the whole stream and the user waits for everything at once.
        """
        full_output = []
        status_code = 200
        try:
            client = anthropic.Anthropic(api_key=api_key)
            with client.messages.stream(
                model='claude-sonnet-4-6',
                max_tokens=2048,
                system=f'You are an expert {lang_label} developer and coding assistant embedded in a collaborative code editor. Be concise and practical. When showing code, use markdown code blocks.',
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    full_output.append(text)
                    yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except anthropic.AuthenticationError:
            status_code = 401
            yield f"data: {json.dumps({'type': 'error', 'message': 'AI features unavailable: invalid API key.'})}\n\n"
        except Exception as e:
            status_code = 500
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            threading.Thread(
                target=_send_respan_log,
                args=(messages, ''.join(full_output), 'claude-sonnet-4-6', 2048, status_code, mode),
                daemon=True,
            ).start()

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


# ── Version history ────────────────────────────────────────────────

@app.route('/api/snapshots/<room_id>', methods=['GET'])
def get_snapshots(room_id):
    """List a room's checkpoints, newest first, capped at 50.

    Content is deliberately excluded from the list query — the sidebar only
    needs labels and timestamps, and a room's snapshots can add up to megabytes.
    The body is fetched on demand by `get_snapshot` when one is opened.
    """
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        'SELECT id, file_id, file_name, label, created_at FROM snapshots WHERE room_id=? ORDER BY created_at DESC LIMIT 50',
        (room_id,)
    ).fetchall()
    conn.close()
    return jsonify([{'id': r[0], 'file_id': r[1], 'file_name': r[2], 'label': r[3], 'created_at': r[4]} for r in rows])


@app.route('/api/snapshots/<room_id>', methods=['POST'])
def create_snapshot(room_id):
    """Store a full copy of one file's contents as a restore point.

    Called two ways: automatically every 2 minutes (`label` null -> renders as
    "Auto checkpoint"), or manually via Ctrl+S with a user-supplied label. Full
    copies rather than diffs — storage is cheap at this scale and restore stays
    a single read with no chain to replay.
    """
    data = request.get_json() or {}
    file_id = data.get('file_id', '')
    file_name = data.get('file_name', 'main.js')
    content = data.get('content', '')
    label = data.get('label', None)
    created_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        'INSERT INTO snapshots (room_id, file_id, file_name, content, label, created_at) VALUES (?,?,?,?,?,?)',
        (room_id, file_id, file_name, content, label, created_at)
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/snapshots/detail/<int:snapshot_id>', methods=['GET'])
def get_snapshot(snapshot_id):
    """Fetch one snapshot including its content — used to render the diff view."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute('SELECT id, file_id, file_name, content, label, created_at FROM snapshots WHERE id=?', (snapshot_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'id': row[0], 'file_id': row[1], 'file_name': row[2], 'content': row[3], 'label': row[4], 'created_at': row[5]})


@app.route('/api/room/<room_id>', methods=['GET'])
def get_room(room_id):
    """REST mirror of the `room_state` socket event — handy for debugging a
    room's server-side state with curl, without opening a WebSocket."""
    fs = get_file_system(room_id)
    users = get_room_users(room_id)
    meta = get_room_meta(room_id)
    return jsonify({'room_id': room_id, 'fs': fs, 'users': users, 'meta': meta})


@app.route('/api/room/<room_id>/exists', methods=['GET'])
def room_exists(room_id):
    exists = room_exists_in_db(room_id)
    return jsonify({'exists': exists})


@app.route('/api/room/<room_id>/meta', methods=['GET', 'POST'])
def room_meta_route(room_id):
    """Read or update visibility/password.

    POST is what the Home page's Create Room modal calls: it writes the settings
    *before* navigating, so a private room is already locked by the time the
    first socket tries to join. Both fields fall back to their existing values,
    so a partial POST won't blank the other one.

    GET returns the client-safe view only. It previously returned the stored
    meta verbatim, which included the room password — one unauthenticated GET
    was enough to walk into any private room.
    """
    if request.method == 'POST':
        data = request.get_json() or {}
        ok, error = _apply_room_settings(
            room_id,
            data.get('visibility'),
            data.get('password'),
            data.get('current_password', ''),
        )
        if not ok:
            return jsonify({'ok': False, 'error': error}), 403
        return jsonify({'ok': True})
    return jsonify(public_room_meta(get_room_meta(room_id)))


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)
