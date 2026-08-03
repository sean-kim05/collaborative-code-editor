import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Code2, Globe, Lock, Plus, ArrowRight, Sparkles, Zap, Users, Play } from 'lucide-react';
import './Home.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

/**
 * Mint a room id: 16 chars from two base-36 randoms.
 *
 * Client-side on purpose — no round trip before navigating. The id *is* the
 * access control for public rooms ("unguessable URL"), so it needs enough
 * entropy to not be brute-forced; two calls are concatenated because one
 * `Math.random().toString(36)` only yields ~8 usable chars.
 *
 * Worth flagging honestly: `Math.random()` is not cryptographically secure.
 * `crypto.randomUUID()` would be the correct primitive for a real product.
 */
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

  /**
   * Create a room: POST the settings, then navigate.
   *
   * The POST has to land *before* navigation so a private room is already
   * password-locked by the time the first socket joins — otherwise there's a
   * window where the room exists as public. The `catch` still navigates: the
   * room gets created implicitly on join, so a failed meta write degrades to a
   * public room rather than a dead end.
   */
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

  /** Join by id or by pasted URL — people share the full link, so accepting
   *  only a bare id would fail the most common case. Splits on `/room/` and
   *  strips any query string. */
  function joinRoom() {
    const raw = joinId.trim();
    if (!raw) return;
    // Accept full URL or bare ID
    const id = raw.startsWith('http') ? raw.split('/room/')[1]?.split('?')[0] : raw;
    if (id) navigate(`/room/${id}`);
  }

  const actions = (
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
  );

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
        <div className="home-nav-right">
          <a className="nav-link" href="#features">Features</a>
          <a className="nav-link" href="https://github.com/sean-kim05/collaborative-code-editor" target="_blank" rel="noreferrer">GitHub</a>
          <button className="nav-cta" onClick={() => setShowCreate(true)}>New room</button>
        </div>
      </nav>

      <main className="home-main">
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-eyebrow">MULTIPLAYER CODE EDITOR</div>
            <h1 className="hero-title">
              Code together, in real time.
            </h1>
            <p className="hero-sub">
              A multiplayer code editor with live cursors, sub-20ms sync, and in-browser
              runtimes — plus an AI assistant when you want one.
            </p>
            {actions}
            <div className="hero-meta">No sign-up&nbsp;&nbsp;·&nbsp;&nbsp;Share a link&nbsp;&nbsp;·&nbsp;&nbsp;p95 sync &lt; 17ms</div>
          </div>

          <div className="hero-shot" aria-hidden="true">
            <div className="shot-frame">
              <img className="shot-img" src="/hero-editor.png" alt="" loading="eager" />
            </div>
          </div>
        </section>

        <section className="proof">
          <div className="proof-item">
            <span className="proof-val">&lt;&nbsp;17ms</span>
            <span className="proof-label">p95 sync latency</span>
          </div>
          <div className="proof-item">
            <span className="proof-val">Live</span>
            <span className="proof-label">multiplayer cursors</span>
          </div>
          <div className="proof-item">
            <span className="proof-val">JS · Python</span>
            <span className="proof-label">run in-browser</span>
          </div>
        </section>

        <section className="features" id="features">
          <div className="feature-card">
            <div className="feature-icon"><Zap size={18} /></div>
            <div className="feature-label">Sub-20ms sync</div>
            <div className="feature-desc">Benchmarked p95 under 17ms — every keystroke, shared instantly.</div>
          </div>
          <div className="feature-card">
            <div className="feature-icon"><Users size={18} /></div>
            <div className="feature-label">Live cursors</div>
            <div className="feature-desc">See exactly where your teammates are, across every file.</div>
          </div>
          <div className="feature-card">
            <div className="feature-icon"><Play size={18} /></div>
            <div className="feature-label">Run in-browser</div>
            <div className="feature-desc">Execute JavaScript and Python right inside the room — no setup.</div>
          </div>
          <div className="feature-card">
            <div className="feature-icon"><Sparkles size={18} /></div>
            <div className="feature-label">AI, built in</div>
            <div className="feature-desc">Explain, fix, improve, or generate code without leaving the editor.</div>
          </div>
        </section>

        <section className="cta-band">
          <div className="cta-eyebrow">START IN ONE CLICK</div>
          <div className="cta-line">No accounts. No setup. Share a link.</div>
          <div className="home-actions">
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={15} /> Create Room
            </button>
            <button
              className="btn-outline"
              onClick={() => { setShowJoin(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            >
              Join Room
            </button>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="footer-left">
          <span className="nav-logo-icon"><Code2 size={14} /></span>
          <span className="footer-name">CollabCode</span>
        </div>
        <div className="footer-right">
          <a className="nav-link" href="https://github.com/sean-kim05/collaborative-code-editor" target="_blank" rel="noreferrer">GitHub</a>
          <span className="footer-credit">Built with Monaco · Flask · Socket.IO · Redis</span>
        </div>
      </footer>
    </div>
  );
}
