from flask import Flask, request, jsonify, Response
from flask_socketio import SocketIO, join_room, leave_room, emit
from flask_cors import CORS
from dotenv import load_dotenv
import os
import subprocess
import tempfile
import time
import json
import sqlite3
import threading
import anthropic
from datetime import datetime, timezone, timedelta

from database import db
import rooms as rooms_module
from rooms import (
    store_room_content, get_room_content,
    add_user_to_room, remove_user_from_room, get_room_users,
    get_user_room, set_user_room, clear_user_room,
    get_file_system, store_file_system, make_file,
    get_room_meta, set_room_meta, room_exists_in_db,
    clear_room_redis_keys, get_language_from_name,
    load_rooms_from_db,
)

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', '')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

CORS(app, origins='*')
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='eventlet')

DB_PATH = os.path.join(os.path.dirname(__file__), 'snapshots.db')


# ── Initialization ─────────────────────────────────────────────────

def init_sqlite():
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
    try:
        room_id = data.get('room_id')
        username = data.get('username', 'Anonymous')
        color = data.get('color', '#ffffff')
        password = data.get('password', '')
        sid = request.sid

        meta = get_room_meta(room_id)
        if meta.get('password') and meta['password'] != password:
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

        emit('room_state', {'fs': fs, 'users': users, 'meta': meta})
        emit('user_joined', user_data, to=room_id, include_self=False)
        emit('user_list', {'users': users}, to=room_id)
    except Exception as e:
        print(f'join_room error: {e}')
        emit('join_error', {'message': 'Failed to join room'})


@socketio.on('create_room')
def on_create_room(data):
    try:
        room_id = data.get('room_id')
        visibility = data.get('visibility', 'public')
        password = data.get('password', None)
        sid = request.sid
        meta = {'visibility': visibility, 'password': password, 'owner': sid}
        set_room_meta(room_id, meta)
        emit('room_created', {'room_id': room_id, 'meta': meta})
    except Exception as e:
        print(f'create_room error: {e}')


@socketio.on('leave_room')
def on_leave_room(data):
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


@socketio.on('cursor_move')
def on_cursor_move(data):
    try:
        room_id = data.get('room_id')
        emit('cursor_move', data, to=room_id, include_self=False)
    except Exception as e:
        print(f'cursor_move error: {e}')


@socketio.on('selection_change')
def on_selection_change(data):
    try:
        room_id = data.get('room_id')
        emit('selection_change', data, to=room_id, include_self=False)
    except Exception as e:
        print(f'selection_change error: {e}')


@socketio.on('typing')
def on_typing(data):
    try:
        room_id = data.get('room_id')
        emit('typing', data, to=room_id, include_self=False)
    except Exception as e:
        print(f'typing error: {e}')


@socketio.on('send_message')
def on_send_message(data):
    try:
        room_id = data.get('room_id')
        emit('new_message', data, to=room_id)
    except Exception as e:
        print(f'send_message error: {e}')


# ── File system events ─────────────────────────────────────────────

@socketio.on('create_file')
def on_create_file(data):
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
    try:
        room_id = data.get('room_id')
        file_id = data.get('file_id')
        session_id = data.get('session_id')
        emit('file_switched', {'file_id': file_id, 'session_id': session_id}, to=room_id, include_self=False)
    except Exception as e:
        print(f'switch_file error: {e}')


# ── REST endpoints ─────────────────────────────────────────────────

@app.route('/api/run', methods=['POST'])
def run_code():
    data = request.get_json() or {}
    language = data.get('language', 'python')
    code = data.get('code', '')
    if language == 'python':
        return run_python(code)
    return jsonify({'error': 'Unsupported language'}), 400


def run_python(code: str):
    start = time.time()
    try:
        with tempfile.NamedTemporaryFile(suffix='.py', mode='w', delete=False) as f:
            f.write(code)
            fname = f.name
        result = subprocess.run(
            ['python3', fname],
            capture_output=True, text=True, timeout=5
        )
        elapsed = round((time.time() - start) * 1000)
        return jsonify({'stdout': result.stdout, 'stderr': result.stderr, 'elapsed_ms': elapsed})
    except subprocess.TimeoutExpired:
        return jsonify({'stdout': '', 'stderr': 'Execution timed out (5s limit)', 'elapsed_ms': 5000})
    except Exception as e:
        return jsonify({'stdout': '', 'stderr': str(e), 'elapsed_ms': 0})
    finally:
        try:
            os.unlink(fname)
        except Exception:
            pass


@app.route('/api/ai', methods=['POST'])
def ai_assist():
    data = request.get_json() or {}
    mode = data.get('mode', 'explain')
    code = data.get('code', '')
    selection = data.get('selection', '')
    language = data.get('language', 'javascript')
    error_msg = data.get('error', '')
    prompt = data.get('prompt', '')
    history = data.get('history', [])

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
        try:
            client = anthropic.Anthropic(api_key=api_key)
            with client.messages.stream(
                model='claude-sonnet-4-6',
                max_tokens=2048,
                system=f'You are an expert {lang_label} developer and coding assistant embedded in a collaborative code editor. Be concise and practical. When showing code, use markdown code blocks.',
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except anthropic.AuthenticationError:
            yield f"data: {json.dumps({'type': 'error', 'message': 'AI features unavailable: invalid API key.'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


# ── Version history ────────────────────────────────────────────────

@app.route('/api/snapshots/<room_id>', methods=['GET'])
def get_snapshots(room_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        'SELECT id, file_id, file_name, label, created_at FROM snapshots WHERE room_id=? ORDER BY created_at DESC LIMIT 50',
        (room_id,)
    ).fetchall()
    conn.close()
    return jsonify([{'id': r[0], 'file_id': r[1], 'file_name': r[2], 'label': r[3], 'created_at': r[4]} for r in rows])


@app.route('/api/snapshots/<room_id>', methods=['POST'])
def create_snapshot(room_id):
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
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute('SELECT id, file_id, file_name, content, label, created_at FROM snapshots WHERE id=?', (snapshot_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'id': row[0], 'file_id': row[1], 'file_name': row[2], 'content': row[3], 'label': row[4], 'created_at': row[5]})


@app.route('/api/room/<room_id>', methods=['GET'])
def get_room(room_id):
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
    if request.method == 'POST':
        data = request.get_json() or {}
        meta = get_room_meta(room_id)
        meta['visibility'] = data.get('visibility', meta.get('visibility', 'public'))
        meta['password'] = data.get('password', meta.get('password'))
        set_room_meta(room_id, meta)
        return jsonify({'ok': True})
    return jsonify(get_room_meta(room_id))


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)
