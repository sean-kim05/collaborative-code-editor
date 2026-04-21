# CollabCode

A real-time collaborative code editor — think VS Code meets Google Docs. Multiple users can write code together in the same room, see each other's cursors, chat, and run code instantly.

**Live Demo:** coming soon

---

## Features

- **Real-time collaboration** — code syncs instantly across all users in a room
- **Multi-cursor tracking** — see where everyone else is editing
- **Built-in chat** — team chat sidebar with unread badge
- **Code execution** — run JavaScript (browser sandbox) or Python (server-side)
- **9 languages** — JavaScript, TypeScript, Python, Java, C++, HTML, CSS, Go, Rust
- **Dark/light theme** — toggle between VS Code-inspired themes
- **Room system** — create or join rooms via URL, shareable links
- **User presence** — colored avatars showing who's in the room

---

## Tech Stack

| Layer | Tech | Why |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | Fast dev, type safety for real-time data |
| Editor | Monaco Editor | Same engine as VS Code |
| Real-time | Socket.IO (client + Flask-SocketIO) | Bidirectional WebSocket events |
| Backend | Flask + Python | Simple REST + WebSocket server |
| Cache | Redis | Shared room state across connections |
| Frontend Deploy | Vercel | Auto-deploys from GitHub |
| Backend Deploy | Render | Free tier with Redis add-on |

---

## Architecture

```
Browser (Tab 1)          Flask + SocketIO          Browser (Tab 2)
     |                         |                         |
     |-- join_room ----------->|                         |
     |<- room_state -----------|                         |
     |                         |<-------- join_room -----|
     |                         |-------- user_joined --->|
     |-- code_change --------->|-------- code_change --->|
     |                         |  (stored in Redis)      |
     |-- send_message -------->|-------- new_message --->|
```

---

## Running Locally

### Prerequisites
- Node.js 18+
- Python 3.11+
- Redis

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
cp .env.example .env
python app.py
```
Backend runs on `http://localhost:5001`

### 3. Frontend
```bash
cd frontend
npm install
npm run dev -- --port 3000
```
Open `http://localhost:3000`

---

## Deploying

### Backend → Render
1. Create a new Web Service on Render, connect this repo, set root dir to `backend`
2. Add a Redis instance on Render (free tier)
3. Set env vars: `SECRET_KEY`, `REDIS_URL` (from the Redis instance)

### Frontend → Vercel
1. Connect repo to Vercel, set root dir to `frontend`
2. Add env var: `VITE_SOCKET_URL` = your Render backend URL

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Enter` | Run code |
| `Ctrl/Cmd + /` | Toggle chat |

---

## License

MIT
