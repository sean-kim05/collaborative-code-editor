# CollabCode

A real-time collaborative code editor — think VS Code meets Google Docs. Multiple users can write and run code together in the same room, with live cursors, an AI code assistant, version history, and chat.

**Live Demo:** [collaborative-code-editor-livid.vercel.app](https://collaborative-code-editor-livid.vercel.app) · [GitHub](https://github.com/sean-kim05/collaborative-code-editor)  
**Backend API:** https://collaborative-code-editor-1as4.onrender.com

---

## Features

- ✅ Real-time collaborative editing with live cursors and selections
- ✅ AI Code Assistant (Claude API) — explain, fix, improve, generate code
- ✅ Code execution — JavaScript (browser sandbox) + Python (server-side)
- ✅ Multi-file support with VS Code-style tabs and file explorer
- ✅ Version history with auto-snapshots every 2 minutes
- ✅ Room chat with unread badge
- ✅ Password-protected rooms
- ✅ Typing indicators
- ✅ Follow mode — click a user's avatar to follow their cursor (Figma-style)
- ✅ Language auto-detection from file extension
- ✅ File upload — drag-and-drop or click-to-upload files from desktop into the editor
- ✅ PostgreSQL persistence — room state survives server restarts

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, Vite, Monaco Editor |
| Real-time | Socket.IO (client) + Flask-SocketIO (server) |
| Backend | Flask, Python 3.11 |
| Persistence | PostgreSQL (source of truth) + Redis (cache layer) |
| Version history | SQLite via `snapshots.db` |
| AI | Anthropic Python SDK (Claude claude-sonnet-4-6, SSE streaming) |
| Frontend deploy | Vercel |
| Backend deploy | Render |

---

## Architecture

```
Browser A                  Flask + SocketIO               Browser B
    |                             |                            |
    |── join_room ──────────────► |                            |
    |◄─ room_state ────────────── |                            |
    |                             |◄─── join_room ─────────── |
    |                             |──── user_joined ─────────► |
    |── code_change ─────────────► ──── code_change ─────────► |
    |                        [Redis cache]                      |
    |                       [PostgreSQL write]                  |
```

**State flow:** All room state (file system, metadata) is written to both Redis (fast reads) and PostgreSQL (survival across restarts). On startup, PostgreSQL hydrates the Redis cache. Active room data is served from Redis; cold reads fall back to PostgreSQL.

---

## Local Development

### Prerequisites
- Node.js 18+
- Python 3.11+
- Redis
- PostgreSQL (optional — falls back to Redis-only without it)

### 1. Start Redis
```bash
brew install redis && brew services start redis
```

### 2. Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create `backend/.env`:
```
REDIS_URL=redis://localhost:6379
SECRET_KEY=dev-secret-key
DATABASE_URL=postgresql://localhost/collabcode   # optional
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
python app.py
# runs on http://localhost:5001
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
# runs on http://localhost:5173
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | Yes | Flask session secret |
| `REDIS_URL` | Yes | Redis connection string |
| `DATABASE_URL` | No | PostgreSQL URL — enables persistence across restarts |
| `ANTHROPIC_API_KEY` | No | Enables AI assistant features |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_SOCKET_URL` | Prod only | Backend URL (defaults to `http://localhost:5001` in dev) |

---

## Deployment

### Backend → Render
1. Create a Web Service, connect this repo, set root dir to `backend`
2. Add a Redis instance (Render add-on)
3. Add a PostgreSQL database (Render add-on)
4. Set env vars: `SECRET_KEY`, `REDIS_URL`, `DATABASE_URL`, `ANTHROPIC_API_KEY`
5. Start command: `gunicorn --worker-class eventlet -w 1 app:app`

### Frontend → Vercel
1. Connect repo, set root dir to `frontend`
2. Add env var: `VITE_SOCKET_URL` = your Render backend URL

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Enter` | Run code |
| `Ctrl/Cmd + I` | Toggle AI assistant |
| `Ctrl/Cmd + S` | Save checkpoint |
| `Ctrl/Cmd + /` | Toggle chat |
| `Escape` | Stop follow mode |

---

## License

MIT
