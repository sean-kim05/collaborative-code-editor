import React from 'react';
import './LoadingScreen.css';

export default function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-logo">⌨</div>
      <div className="loading-text">Joining room…</div>
      <div className="loading-dots">
        <span /><span /><span />
      </div>
    </div>
  );
}
