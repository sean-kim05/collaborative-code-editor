import json
import redis
import os

_redis_client = None

def get_redis():
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379'))
    return _redis_client

def store_room_content(room_id: str, content: str):
    get_redis().set(f'room:{room_id}:content', content)

def get_room_content(room_id: str) -> str:
    val = get_redis().get(f'room:{room_id}:content')
    return val.decode('utf-8') if val else ''

def add_user_to_room(room_id: str, user_data: dict):
    r = get_redis()
    key = f'room:{room_id}:users'
    users = get_room_users(room_id)
    users = [u for u in users if u.get('session_id') != user_data.get('session_id')]
    users.append(user_data)
    r.set(key, json.dumps(users))

def remove_user_from_room(room_id: str, session_id: str):
    r = get_redis()
    key = f'room:{room_id}:users'
    users = get_room_users(room_id)
    users = [u for u in users if u.get('session_id') != session_id]
    r.set(key, json.dumps(users))

def get_room_users(room_id: str) -> list:
    r = get_redis()
    key = f'room:{room_id}:users'
    val = r.get(key)
    if not val:
        return []
    try:
        return json.loads(val.decode('utf-8'))
    except Exception:
        return []

def get_user_room(session_id: str) -> str | None:
    r = get_redis()
    val = r.get(f'session:{session_id}:room')
    return val.decode('utf-8') if val else None

def set_user_room(session_id: str, room_id: str):
    get_redis().set(f'session:{session_id}:room', room_id)

def clear_user_room(session_id: str):
    get_redis().delete(f'session:{session_id}:room')
