import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Users, Code2, Globe, Lock, Plus, ArrowRight, Clock, X } from 'lucide-react';
import { getRecentRooms, removeRecentRoom, formatRelativeTime, type RecentRoom } from '../utils/recentRooms';
import './Home.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

function generateRoomId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

export default function Home() {
  const navigate = useNavigate();
  const [joinId, setJoinId] = useState('');
  const [showJoin, setShowJoin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [recent, setRecent] = useState<RecentRoom[]>([]);

  useEffect(() => {
    setRecent(getRecentRooms());
  }, []);

  function handleRemoveRecent(e: React.MouseEvent, roomId: string) {
    e.stopPropagation();
    removeRecentRoom(roomId);
    setRecent(getRecentRooms());
  }

  async function createRoom() {
    setCreating(true);
    const roomId = generateRoomId();
    try {
      await fetch(`${SOCKET_URL}/api/room/${roomId}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility, password: password || null }),
      });
    } catch { /* proceed even if meta pre-set fails — room will be created on join */ }
    navigate(`/room/${roomId}`);
  }

  function joinRoom() {
    const raw = joinId.trim();
    if (!raw) return;
    // Accept full URL or bare ID
    const id = raw.startsWith('http') ? raw.split('/room/')[1]?.split('?')[0] : raw;
    if (id) navigate(`/room/${id}`);
  }

  return (
    <div className="home">
      <div className="home-bg" />

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Create Room</span>
              <button className="modal-close" onClick={() => setShowCreate(false)} aria-label="Close">✕</button>
            </div>

            <div className="modal-body">
              <div className="modal-field">
                <label className="modal-label">Visibility</label>
                <div className="vis-toggle">
                  <button
                    className={`vis-btn ${visibility === 'public' ? 'active' : ''}`}
                    onClick={() => setVisibility('public')}
                  >
                    <Globe size={14} /> Public
                  </button>
                  <button
                    className={`vis-btn ${visibility === 'private' ? 'active' : ''}`}
                    onClick={() => setVisibility('private')}
                  >
                    <Lock size={14} /> Private
                  </button>
                </div>
                <p className="modal-hint">
                  {visibility === 'public'
                    ? 'Anyone with the link can join.'
                    : 'Only people with the password can join.'}
                </p>
              </div>

              {visibility === 'private' && (
                <div className="modal-field">
                  <label className="modal-label">Password</label>
                  <input
                    className="modal-input"
                    type="text"
                    placeholder="Set a room password…"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                  />
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button
                className="btn-primary"
                onClick={createRoom}
                disabled={creating || (visibility === 'private' && !password.trim())}
              >
                {creating ? 'Creating…' : <><span>Create Room</span><ArrowRight size={14} /></>}
              </button>
            </div>
          </div>
        </div>
      )}

      <nav className="home-nav">
        <div className="home-nav-logo">
          <span className="nav-logo-icon"><Code2 size={16} /></span>
          <span className="nav-logo-text">CollabCode</span>
        </div>
        <a className="nav-link" href="https://github.com/sean-kim05/collaborative-code-editor" target="_blank" rel="noreferrer">GitHub</a>
      </nav>

      <main className="home-main">
        <h1 className="home-title">CollabCode</h1>
        <p className="home-tagline">Code together, with Claude in the room.</p>
        <p className="home-subtitle">
          Real-time collaborative rooms with Claude built in — to explain, fix, and improve code as you write it.
        </p>

        <div className="home-actions">
          {!showJoin ? (
            <>
              <button className="btn-primary" onClick={() => setShowCreate(true)}>
                <Plus size={15} /> Create Room
              </button>
              <button className="btn-outline" onClick={() => setShowJoin(true)}>
                Join Room
              </button>
            </>
          ) : (
            <div className="join-form">
              <input
                className="join-input"
                placeholder="Paste room ID or URL…"
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
                autoFocus
              />
              <button className="btn-primary" onClick={joinRoom} disabled={!joinId.trim()}>
                Join <ArrowRight size={14} />
              </button>
              <button className="btn-ghost" onClick={() => setShowJoin(false)}>Cancel</button>
            </div>
          )}
        </div>

        {recent.length > 0 && (
          <div className="recent-rooms">
            <div className="recent-rooms-header">
              <Clock size={14} />
              <span>Recent Rooms</span>
            </div>
            <div className="recent-rooms-list">
              {recent.map((r) => (
                <button
                  key={r.roomId}
                  className="recent-room-card"
                  onClick={() => navigate(`/room/${r.roomId}`)}
                  title={`Visited ${formatRelativeTime(r.visitedAt)}`}
                >
                  <span className="recent-room-id">{r.roomId}</span>
                  <span className="recent-room-time">{formatRelativeTime(r.visitedAt)}</span>
                  <span
                    className="recent-room-remove"
                    onClick={(e) => handleRemoveRecent(e, r.roomId)}
                    aria-label="Remove from recent"
                    role="button"
                  >
                    <X size={12} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="home-features">
          <div className="feature-card">
            <div className="feature-icon"><Zap size={18} /></div>
            <div className="feature-label">Real-time sync</div>
            <div className="feature-desc">Every keystroke synced instantly across all collaborators</div>
          </div>
          <div className="feature-card">
            <div className="feature-icon"><Users size={18} /></div>
            <div className="feature-label">Live cursors</div>
            <div className="feature-desc">See exactly where your teammates are in the code</div>
          </div>
          <div className="feature-card">
            <div className="feature-icon"><Code2 size={18} /></div>
            <div className="feature-label">Any language</div>
            <div className="feature-desc">JavaScript, Python, TypeScript, Go, Rust and more</div>
          </div>
        </div>
      </main>
    </div>
  );
}
