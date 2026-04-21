import json
import uuid
import os

try:
    import redis as _redis_lib
    _redis_client = _redis_lib.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379'))
    _redis_client.ping()
    USE_REDIS = True
except Exception:
    USE_REDIS = False
    _memory: dict = {}

def _get_redis():
    return _redis_client if USE_REDIS else None

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

# ── Room content (single-file legacy, kept for default init) ───────
def store_room_content(room_id: str, content: str):
    _set(f'room:{room_id}:content', content)

def get_room_content(room_id: str) -> str:
    val = _get(f'room:{room_id}:content')
    return val or ''

# ── File system ────────────────────────────────────────────────────
LANG_EXT = {
    'javascript': 'js', 'typescript': 'ts', 'python': 'py',
    'java': 'java', 'cpp': 'cpp', 'html': 'html', 'css': 'css',
    'go': 'go', 'rust': 'rs',
}

def make_file(name: str, content: str = '', language: str = 'javascript') -> dict:
    return {'id': str(uuid.uuid4()), 'name': name, 'content': content, 'language': language}

def get_file_system(room_id: str) -> dict:
    data = _get(f'fs:{room_id}')
    if data:
        return json.loads(data)
    content = get_room_content(room_id)
    default_file = make_file('main.js', content, 'javascript')
    fs = {'files': [default_file], 'activeFileId': default_file['id']}
    store_file_system(room_id, fs)
    return fs

def store_file_system(room_id: str, fs: dict):
    _set(f'fs:{room_id}', json.dumps(fs))

# ── Room metadata ──────────────────────────────────────────────────
def get_room_meta(room_id: str) -> dict:
    data = _get(f'meta:{room_id}')
    if data:
        return json.loads(data)
    return {'visibility': 'public', 'password': None, 'owner': None}

def set_room_meta(room_id: str, meta: dict):
    _set(f'meta:{room_id}', json.dumps(meta))

# ── Users ──────────────────────────────────────────────────────────
def add_user_to_room(room_id: str, user_data: dict):
    key = f'room:{room_id}:users'
    users = get_room_users(room_id)
    users = [u for u in users if u.get('session_id') != user_data.get('session_id')]
    users.append(user_data)
    _set(key, json.dumps(users))

def remove_user_from_room(room_id: str, session_id: str):
    key = f'room:{room_id}:users'
    users = get_room_users(room_id)
    users = [u for u in users if u.get('session_id') != session_id]
    _set(key, json.dumps(users))

def get_room_users(room_id: str) -> list:
    val = _get(f'room:{room_id}:users')
    if not val:
        return []
    try:
        return json.loads(val)
    except Exception:
        return []

def get_user_room(session_id: str):
    return _get(f'session:{session_id}:room')

def set_user_room(session_id: str, room_id: str):
    _set(f'session:{session_id}:room', room_id)

def clear_user_room(session_id: str):
    _del(f'session:{session_id}:room')
