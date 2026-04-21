import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';

function generateRoomId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

export default function Home() {
  const navigate = useNavigate();
  const [joinId, setJoinId] = useState('');

  function createRoom() {
    navigate(`/room/${generateRoomId()}`);
  }

  function joinRoom() {
    const id = joinId.trim();
    if (id) navigate(`/room/${id}`);
  }

  return (
    <div className="home">
      <div className="home-content">
        <div className="home-logo">⌨</div>
        <h1 className="home-title">CollabCode</h1>
        <p className="home-tagline">Code together, in real time.</p>

        <div className="home-actions">
          <button className="btn-create" onClick={createRoom}>
            + Create New Room
          </button>

          <div className="home-divider"><span>or join existing</span></div>

          <div className="join-row">
            <input
              className="join-input"
              placeholder="Paste a room ID…"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
            />
            <button className="btn-join" onClick={joinRoom} disabled={!joinId.trim()}>
              Join
            </button>
          </div>
        </div>

        <div className="home-features">
          <div className="feature">
            <span className="feature-icon">⚡</span>
            <span>Real-time collaboration</span>
          </div>
          <div className="feature">
            <span className="feature-icon">🎨</span>
            <span>Live cursor tracking</span>
          </div>
          <div className="feature">
            <span className="feature-icon">💬</span>
            <span>Built-in team chat</span>
          </div>
          <div className="feature">
            <span className="feature-icon">▶</span>
            <span>Run code instantly</span>
          </div>
        </div>
      </div>
    </div>
  );
}
