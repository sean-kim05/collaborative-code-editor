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

_USE_PG = bool(os.getenv('DATABASE_URL'))
_db = None
_Room = None
_RoomFile = None


def init_pg():
    """Called from app.py after db.init_app(app) and db.create_all()."""
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
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    return _LANG_MAP.get(ext, 'plaintext')


# ── Room content (legacy, kept for default init) ───────────────────
def store_room_content(room_id: str, content: str):
    _set(f'room:{room_id}:content', content)


def get_room_content(room_id: str) -> str:
    return _get(f'room:{room_id}:content') or ''


# ── File system ────────────────────────────────────────────────────
def make_file(name: str, content: str = '', language: str = '') -> dict:
    lang = language or get_language_from_name(name)
    return {'id': str(uuid.uuid4()), 'name': name, 'content': content, 'language': lang}


def get_file_system(room_id: str) -> dict:
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
    """On startup, warm Redis cache from PostgreSQL."""
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
    if _get(f'fs:{room_id}') or _get(f'meta:{room_id}'):
        return True
    if _USE_PG:
        try:
            return _Room.query.filter_by(room_id=room_id).first() is not None
        except Exception:
            pass
    return False


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
