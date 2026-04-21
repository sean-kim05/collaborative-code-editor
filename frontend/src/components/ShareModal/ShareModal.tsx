import React, { useState } from 'react';
import './ShareModal.css';

interface Props {
  roomId: string;
  onClose: () => void;
  onCopied: () => void;
}

export default function ShareModal({ roomId, onClose, onCopied }: Props) {
  const url = `${window.location.origin}/room/${roomId}`;
  const [copied, setCopied] = useState(false);

  function copyUrl() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    onCopied();
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Share room</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="modal-section">
            <label className="modal-label">Room link</label>
            <div className="url-row">
              <input className="url-input" value={url} readOnly />
              <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={copyUrl}>
                {copied ? '✓ Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="modal-section">
            <label className="modal-label">Invite teammates</label>
            <p className="modal-hint">Share the link above with anyone you want to collaborate with. They'll join instantly — no account needed.</p>
          </div>

          <div className="modal-section">
            <label className="modal-label">Room ID</label>
            <div className="room-id-display">
              <code className="room-id-code">{roomId}</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
