import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
              <button className="modal-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="modal-field">
                <label className="modal-label">Visibility</label>
                <div className="vis-toggle">
                  <button
                    className={`vis-btn ${visibility === 'public' ? 'active' : ''}`}
                    onClick={() => setVisibility('public')}
                  >
                    🌐 Public
                  </button>
                  <button
                    className={`vis-btn ${visibility === 'private' ? 'active' : ''}`}
                    onClick={() => setVisibility('private')}
                  >
                    🔒 Private
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
                {creating ? 'Creating…' : 'Create Room →'}
              </button>
            </div>
          </div>
        </div>
      )}

      <nav className="home-nav">
        <div className="home-nav-logo">
          <span className="nav-logo-icon">⌨</span>
          <span className="nav-logo-text">CollabCode</span>
        </div>
        <a className="nav-link" href="https://github.com/sean-kim05/collaborative-code-editor" target="_blank" rel="noreferrer">GitHub</a>
      </nav>

      <main className="home-main">
        <div className="home-badge">Now in beta</div>

        <h1 className="home-title">
          <span className="gradient-text">CollabCode</span>
        </h1>
        <p className="home-tagline">Write code together, in real time.</p>

        <div className="home-actions">
          {!showJoin ? (
            <>
              <button className="btn-primary" onClick={() => setShowCreate(true)}>
                <span className="btn-icon">+</span> Create Room
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
                Join →
              </button>
              <button className="btn-ghost" onClick={() => setShowJoin(false)}>Cancel</button>
            </div>
          )}
        </div>

        <div className="home-features">
          <div className="feature-card">
            <div className="feature-icon" style={{ color: 'var(--accent)' }}>⚡</div>
            <div className="feature-label">Real-time sync</div>
            <div className="feature-desc">Every keystroke synced instantly across all collaborators</div>
          </div>
          <div className="feature-card">
            <div className="feature-icon" style={{ color: 'var(--accent-secondary)' }}>👥</div>
            <div className="feature-label">Live cursors</div>
            <div className="feature-desc">See exactly where your teammates are in the code</div>
          </div>
          <div className="feature-card">
            <div className="feature-icon" style={{ color: 'var(--success)' }}>{ }</div>
            <div className="feature-label">Any language</div>
            <div className="feature-desc">JavaScript, Python, TypeScript, Go, Rust and more</div>
          </div>
        </div>

        <div className="home-mockup">
          <div className="mockup-bar">
            <div className="mockup-dot" style={{ background: 'var(--error)' }} />
            <div className="mockup-dot" style={{ background: 'var(--warning)' }} />
            <div className="mockup-dot" style={{ background: 'var(--success)' }} />
            <span className="mockup-title">CollabCode — room/a1b2c3d4</span>
          </div>
          <div className="mockup-body">
            <div className="mockup-sidebar">
              <div className="mockup-file active">main.ts</div>
              <div className="mockup-file">utils.ts</div>
              <div className="mockup-file">types.ts</div>
            </div>
            <div className="mockup-editor">
              {[
                { indent: 0, color: 'var(--accent)', text: 'const' },
                { indent: 1, color: 'var(--accent-secondary)', text: 'function' },
                { indent: 1, color: 'var(--text-secondary)', text: '' },
                { indent: 2, color: 'var(--accent)', text: 'return' },
                { indent: 1, color: 'var(--text-muted)', text: '}' },
              ].map((line, i) => (
                <div key={i} className="mockup-line" style={{ paddingLeft: `${line.indent * 16}px` }}>
                  <span className="mockup-ln">{i + 1}</span>
                  <span className="mockup-code" style={{ background: line.color, width: `${60 + Math.random() * 80}px` }} />
                </div>
              ))}
              <div className="mockup-cursor" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
