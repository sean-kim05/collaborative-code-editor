"""Storage layer for rooms — a two-tier cache-aside store over Redis + PostgreSQL.

The split, and why:

  Redis        Hot path. Every read on the socket path hits Redis first. Room
               state is small JSON blobs, read constantly and written on every
               keystroke, so an in-memory store is the right shape.
  PostgreSQL   Durability. Redis on a hosted free tier can be evicted or wiped;
               PostgreSQL is what makes a room survive a deploy. Relational
               because files belong to rooms and we want cascade deletes.

Access pattern is **cache-aside on read, write-through on write**:
  read  -> Redis hit? return it. Miss? load from PG, backfill Redis, return.
  write -> write Redis (so the next read is instant), then write PG.

Both tiers degrade independently, which is the point: no Redis falls back to a
process-local dict (`_memory`), no `DATABASE_URL` skips PG entirely. `git clone
&& python app.py` works with neither installed — only durability is lost.

Key namespace:
    fs:<room>              -> the file tree, as JSON
    meta:<room>            -> visibility / password / owner
    room:<room>:users      -> presence roster, as JSON
    session:<sid>:room     -> reverse index, so a disconnect can find its room
"""
import json
import uuid
import os

# Probe Redis once at import with a ping — `from_url` alone is lazy and would
# not fail until the first real command. Falling back here means the rest of the
# module never has to care which backend it's talking to.
try:
    import redis as _redis_lib
    _redis_client = _redis_lib.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379'))
    _redis_client.ping()
    USE_REDIS = True
except Exception:
    USE_REDIS = False
    _memory: dict = {}

_USE_PG = bool(os.getenv('DATABASE_URL'))
_db = None
_Room = None
_RoomFile = None


def init_pg():
    """Called from app.py after db.init_app(app) and db.create_all().

    The models are imported *here* rather than at module top to avoid a circular
    import (app -> rooms -> database -> app's db instance) and to keep this
    module importable when SQLAlchemy isn't configured at all. `_USE_PG` is the
    single flag every write path checks afterwards.
    """
    global _USE_PG, _db, _Room, _RoomFile
    if not os.getenv('DATABASE_URL'):
        _USE_PG = False
        return
    try:
        from database import db, Room, RoomFile
        _db = db
        _Room = Room
        _RoomFile = RoomFile
        _USE_PG = True
        print('PostgreSQL persistence enabled')
    except Exception as e:
        _USE_PG = False
        print(f'PostgreSQL not available, using Redis only: {e}')


# Backend-agnostic KV primitives. Every caller below goes through these three,
# so swapping Redis for anything else is a change in one place. Redis returns
# bytes; the decode here means callers only ever see `str | None`.

def _get(key):
    if USE_REDIS:
        val = _redis_client.get(key)
        return val.decode('utf-8') if val else None
    return _memory.get(key)


def _set(key, value):
    if USE_REDIS:
        _redis_client.set(key, value)
    else:
        _memory[key] = value


def _del(key):
    if USE_REDIS:
        _redis_client.delete(key)
    else:
        _memory.pop(key, None)


def clear_room_redis_keys(room_id: str):
    """Evict every cache entry for a room. Used by the 30-day expiry reaper —
    dropping the PG rows without this would leave the room resurrectable
    from a stale cache."""
    _del(f'fs:{room_id}')
    _del(f'meta:{room_id}')
    _del(f'room:{room_id}:users')
    _del(f'room:{room_id}:content')


# ── Language detection ─────────────────────────────────────────────
_LANG_MAP = {
    'js': 'javascript', 'jsx': 'javascript',
    'ts': 'typescript', 'tsx': 'typescript',
    'py': 'python', 'java': 'java',
    'cpp': 'cpp', 'cc': 'cpp', 'cxx': 'cpp', 'c': 'cpp',
    'html': 'html', 'css': 'css',
    'go': 'go', 'rs': 'rust',
    'md': 'markdown', 'json': 'json',
    'sh': 'shell', 'sql': 'sql',
}


def get_language_from_name(name: str) -> str:
    """Map a filename to a Monaco language id, defaulting to plaintext.

    Server-side so it stays authoritative: a rename broadcasts the derived
    language to every client at once, instead of each one guessing separately.
    (FileExplorer.tsx keeps a matching client-side copy for optimistic UI.)
    """
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    return _LANG_MAP.get(ext, 'plaintext')


# ── Room content (legacy, kept for default init) ───────────────────
# Predates multi-file support, when a room was a single buffer. Still read once
# by `get_file_system` so a room created under the old model migrates its text
# into `main.js` instead of coming back empty.
def store_room_content(room_id: str, content: str):
    _set(f'room:{room_id}:content', content)


def get_room_content(room_id: str) -> str:
    return _get(f'room:{room_id}:content') or ''


# ── File system ────────────────────────────────────────────────────
def make_file(name: str, content: str = '', language: str = '') -> dict:
    """Build a file node with a server-generated uuid.

    Ids are minted here, never by the client — that's what makes them safe to
    use as the merge key in `store_file_system` and as the addressing key in
    `code_change`. Two clients creating a file at the same moment get distinct
    ids rather than colliding on a name.
    """
    lang = language or get_language_from_name(name)
    return {'id': str(uuid.uuid4()), 'name': name, 'content': content, 'language': lang}


def get_file_system(room_id: str) -> dict:
    """Return a room's file tree, creating it on first access. Cache-aside read.

    Three tiers, tried in order:
      1. Redis — the case that matters, since this runs on every edit.
      2. PostgreSQL — a cold room after a restart or eviction. The result is
         written back to Redis so tier 2 is paid exactly once per room.
      3. Fresh tree — an id that has never existed. This is why there's no
         explicit "create room" call anywhere: visiting a URL is enough.

    A PG failure logs and falls through to tier 3 rather than raising: better a
    working editor than a 500 (the trade being that a transient DB blip could
    hand back an empty room).
    """
    # Fast path: Redis cache
    data = _get(f'fs:{room_id}')
    if data:
        return json.loads(data)

    # Persistent path: PostgreSQL
    if _USE_PG:
        try:
            room = _Room.query.filter_by(room_id=room_id).first()
            if room:
                files = _RoomFile.query.filter_by(room_id=room_id).all()
                if files:
                    file_list = [
                        {'id': f.file_id, 'name': f.name, 'content': f.content, 'language': f.language}
                        for f in files
                    ]
                    active = room.active_file_id or file_list[0]['id']
                    fs = {'files': file_list, 'activeFileId': active}
                    _set(f'fs:{room_id}', json.dumps(fs))
                    return fs
        except Exception as e:
            print(f'PG get_file_system error: {e}')

    # Default: create new fs
    content = get_room_content(room_id)
    default_file = make_file('main.js', content)
    fs = {'files': [default_file], 'activeFileId': default_file['id']}
    store_file_system(room_id, fs)
    return fs


def store_file_system(room_id: str, fs: dict):
    """Persist a room's file tree. Write-through: Redis first, then PostgreSQL.

    Redis is written before PG on purpose — it's the tier every subsequent read
    hits, so the next keystroke sees fresh data even if the PG write is slow or
    fails outright. The tradeoff is a window where the cache is ahead of the
    database; acceptable because Redis is the read source of truth while a room
    is live, and PG only has to be right by the time the room goes cold.

    The PG half is a three-way reconcile against the incoming tree, keyed on the
    server-generated `file_id`:
        in both      -> update in place (keeps the row's identity and id)
        new          -> insert
        missing      -> delete (this is how `delete_file` reaches the database)
    Rolling back on failure matters here: SQLAlchemy leaves the session dirty
    after an error, and without the rollback every later write in the same
    connection would fail too.

    Also bumps `last_active`, which is the clock the 30-day expiry reaper reads.
    """
    _set(f'fs:{room_id}', json.dumps(fs))

    if _USE_PG:
        try:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)

            room = _Room.query.filter_by(room_id=room_id).first()
            if not room:
                room = _Room(room_id=room_id, created_at=now, last_active=now)
                _db.session.add(room)

            room.last_active = now
            room.active_file_id = fs.get('activeFileId')

            existing = {f.file_id: f for f in _RoomFile.query.filter_by(room_id=room_id).all()}
            seen_ids = set()

            for f in fs.get('files', []):
                fid = f['id']
                seen_ids.add(fid)
                if fid in existing:
                    row = existing[fid]
                    row.name = f['name']
                    row.content = f['content']
                    row.language = f.get('language', 'plaintext')
                    row.updated_at = now
                else:
                    row = _RoomFile(
                        room_id=room_id, file_id=fid,
                        name=f['name'], content=f['content'],
                        language=f.get('language', 'plaintext'),
                        updated_at=now,
                    )
                    _db.session.add(row)

            for fid, row in existing.items():
                if fid not in seen_ids:
                    _db.session.delete(row)

            _db.session.commit()
        except Exception as e:
            print(f'PG store_file_system error: {e}')
            try:
                _db.session.rollback()
            except Exception:
                pass


def load_rooms_from_db():
    """On startup, warm Redis cache from PostgreSQL.

    Not strictly required — `get_file_system` would rehydrate each room lazily
    on first access anyway. Doing it upfront means the first person back into a
    room after a deploy doesn't eat the PG round trip.

    The `if _get(...): continue` guard makes this safe to re-run: a room already
    cached is skipped, so a warm Redis is never overwritten with staler DB rows.
    """
    if not _USE_PG:
        return
    try:
        rooms = _Room.query.all()
        loaded = 0
        for room in rooms:
            if _get(f'fs:{room.room_id}'):
                continue
            files = _RoomFile.query.filter_by(room_id=room.room_id).all()
            if not files:
                continue
            file_list = [
                {'id': f.file_id, 'name': f.name, 'content': f.content, 'language': f.language}
                for f in files
            ]
            active = room.active_file_id or file_list[0]['id']
            fs = {'files': file_list, 'activeFileId': active}
            _set(f'fs:{room.room_id}', json.dumps(fs))

            meta = {'visibility': room.visibility or 'public', 'password': room.password, 'owner': None}
            if not _get(f'meta:{room.room_id}'):
                _set(f'meta:{room.room_id}', json.dumps(meta))
            loaded += 1
        print(f'Loaded {loaded} rooms from PostgreSQL into Redis')
    except Exception as e:
        print(f'Failed to load rooms from DB: {e}')


# ── Room metadata ──────────────────────────────────────────────────
def get_room_meta(room_id: str) -> dict:
    """Fetch visibility/password/owner, same cache-aside ladder as the file tree.

    Unknown rooms return a public default rather than raising, which is what
    makes "navigate to any URL and you're in" work.

    `owner` is intentionally never restored from PG — it's a live socket id, so
    a value read back after a restart would point at a connection that no longer
    exists. It re-elects itself when the first person joins.
    """
    data = _get(f'meta:{room_id}')
    if data:
        return json.loads(data)

    if _USE_PG:
        try:
            room = _Room.query.filter_by(room_id=room_id).first()
            if room:
                meta = {'visibility': room.visibility or 'public', 'password': room.password, 'owner': None}
                _set(f'meta:{room_id}', json.dumps(meta))
                return meta
        except Exception as e:
            print(f'PG get_room_meta error: {e}')

    return {'visibility': 'public', 'password': None, 'owner': None}


def set_room_meta(room_id: str, meta: dict):
    """Write room settings through to both tiers, creating the PG row if needed.

    This is the other path (besides `store_file_system`) that can bring a room
    into existence — it's how the Home page locks a private room before anyone
    has joined and before any file exists.
    """
    _set(f'meta:{room_id}', json.dumps(meta))

    if _USE_PG:
        try:
            from datetime import datetime, timezone
            room = _Room.query.filter_by(room_id=room_id).first()
            if not room:
                room = _Room(room_id=room_id, created_at=datetime.now(timezone.utc), last_active=datetime.now(timezone.utc))
                _db.session.add(room)
            room.visibility = meta.get('visibility', 'public')
            room.password = meta.get('password')
            _db.session.commit()
        except Exception as e:
            print(f'PG set_room_meta error: {e}')
            try:
                _db.session.rollback()
            except Exception:
                pass


def room_exists_in_db(room_id: str) -> bool:
    """Has this room ever been used? Checks cache first, then PG.

    Distinguishes "joining an existing room" from "minting a new one at a typo'd
    URL" — the only place that distinction is visible, since every other read
    path happily creates on miss.
    """
    if _get(f'fs:{room_id}') or _get(f'meta:{room_id}'):
        return True
    if _USE_PG:
        try:
            return _Room.query.filter_by(room_id=room_id).first() is not None
        except Exception:
            pass
    return False


# ── Users ──────────────────────────────────────────────────────────
# Presence is Redis-only — never written to PostgreSQL. It's valid for exactly
# as long as a socket is open, so persisting it would only create ghosts.
# Stored as one JSON list per room rather than a Redis set: rooms hold a handful
# of people, and read-modify-write on a small blob is simpler than modelling it.

def add_user_to_room(room_id: str, user_data: dict):
    """Add a user to the roster, replacing any prior entry with the same sid.

    The filter-then-append makes joins idempotent: a reconnect that reuses a sid
    updates in place instead of showing the same person twice.
    """
    key = f'room:{room_id}:users'
    users = get_room_users(room_id)
    users = [u for u in users if u.get('session_id') != user_data.get('session_id')]
    users.append(user_data)
    _set(key, json.dumps(users))


def remove_user_from_room(room_id: str, session_id: str):
    """Drop a user from the roster on leave or disconnect."""
    key = f'room:{room_id}:users'
    users = get_room_users(room_id)
    users = [u for u in users if u.get('session_id') != session_id]
    _set(key, json.dumps(users))


def get_room_users(room_id: str) -> list:
    """Current roster, or an empty list. Never raises — a corrupt blob degrades
    to "nobody here" rather than taking down the join handler."""
    val = _get(f'room:{room_id}:users')
    if not val:
        return []
    try:
        return json.loads(val)
    except Exception:
        return []


# Reverse index: socket id -> room. Exists purely for `on_disconnect`, which
# gets a dead socket and no payload — without this there'd be no way to know
# which room to remove the user from short of scanning every room's roster.

def get_user_room(session_id: str):
    return _get(f'session:{session_id}:room')


def set_user_room(session_id: str, room_id: str):
    _set(f'session:{session_id}:room', room_id)


def clear_user_room(session_id: str):
    _del(f'session:{session_id}:room')
