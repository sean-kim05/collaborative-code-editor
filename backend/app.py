from flask import Flask, request, jsonify
from flask_socketio import SocketIO, join_room, leave_room, emit
from flask_cors import CORS
from dotenv import load_dotenv
import os
import subprocess
import tempfile
import time

from rooms import (
    store_room_content, get_room_content,
    add_user_to_room, remove_user_from_room, get_room_users,
    get_user_room, set_user_room, clear_user_room
)

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')

CORS(app, origins=['http://localhost:5173', 'http://127.0.0.1:5173'])

socketio = SocketIO(
    app,
    cors_allowed_origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
    async_mode='eventlet'
)


# --- Socket.IO events ---

@socketio.on('connect')
def on_connect():
    print(f'Client connected: {request.sid}')

@socketio.on('disconnect')
def on_disconnect():
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

@socketio.on('join_room')
def on_join_room(data):
    room_id = data.get('room_id')
    username = data.get('username', 'Anonymous')
    color = data.get('color', '#ffffff')
    sid = request.sid

    join_room(room_id)
    set_user_room(sid, room_id)

    user_data = {'session_id': sid, 'username': username, 'color': color}
    add_user_to_room(room_id, user_data)

    users = get_room_users(room_id)
    content = get_room_content(room_id)

    emit('room_state', {'content': content, 'users': users})
    emit('user_joined', user_data, to=room_id, include_self=False)
    emit('user_list', {'users': users}, to=room_id)

@socketio.on('leave_room')
def on_leave_room(data):
    room_id = data.get('room_id')
    sid = request.sid
    remove_user_from_room(room_id, sid)
    clear_user_room(sid)
    leave_room(room_id)
    users = get_room_users(room_id)
    emit('user_list', {'users': users}, to=room_id)
    emit('user_left', {'session_id': sid}, to=room_id)

@socketio.on('code_change')
def on_code_change(data):
    room_id = data.get('room_id')
    content = data.get('content', '')
    store_room_content(room_id, content)
    emit('code_change', data, to=room_id, include_self=False)

@socketio.on('cursor_move')
def on_cursor_move(data):
    room_id = data.get('room_id')
    emit('cursor_move', data, to=room_id, include_self=False)

@socketio.on('get_room_state')
def on_get_room_state(data):
    room_id = data.get('room_id')
    content = get_room_content(room_id)
    users = get_room_users(room_id)
    emit('room_state', {'content': content, 'users': users})

@socketio.on('send_message')
def on_send_message(data):
    room_id = data.get('room_id')
    emit('new_message', data, to=room_id)


# --- REST endpoints ---

@app.route('/api/run', methods=['POST'])
def run_code():
    data = request.get_json() or {}
    language = data.get('language', 'python')
    code = data.get('code', '')

    if language == 'python':
        return run_python(code)
    return jsonify({'error': 'Unsupported language for server execution'}), 400

def run_python(code: str):
    start = time.time()
    try:
        with tempfile.NamedTemporaryFile(suffix='.py', mode='w', delete=False) as f:
            f.write(code)
            fname = f.name
        result = subprocess.run(
            ['python3', '-c', f'import sys; sys.stdin = open("/dev/null"); exec(open("{fname}").read())'],
            capture_output=True, text=True, timeout=5
        )
        elapsed = round((time.time() - start) * 1000)
        return jsonify({
            'stdout': result.stdout,
            'stderr': result.stderr,
            'elapsed_ms': elapsed
        })
    except subprocess.TimeoutExpired:
        return jsonify({'stdout': '', 'stderr': 'Execution timed out (5s limit)', 'elapsed_ms': 5000})
    except Exception as e:
        return jsonify({'stdout': '', 'stderr': str(e), 'elapsed_ms': 0})
    finally:
        try:
            os.unlink(fname)
        except Exception:
            pass

@app.route('/api/room/<room_id>', methods=['GET'])
def get_room(room_id):
    content = get_room_content(room_id)
    users = get_room_users(room_id)
    return jsonify({'room_id': room_id, 'content': content, 'users': users})


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)
