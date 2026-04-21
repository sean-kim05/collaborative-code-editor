import React from 'react';
import UserPresence from '../UserPresence/UserPresence';
import { User } from '../../types';
import './Toolbar.css';

const LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
];

interface Props {
  roomId: string;
  language: string;
  onLanguageChange: (lang: string) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  theme: 'dark' | 'light';
  onThemeToggle: () => void;
  users: User[];
  currentSessionId?: string;
  connected: boolean;
  chatOpen: boolean;
  onChatToggle: () => void;
  unreadCount: number;
  onShare: () => void;
  onRun: () => void;
  onLeave: () => void;
}

export default function Toolbar({
  roomId, language, onLanguageChange, fontSize, onFontSizeChange,
  theme, onThemeToggle, users, currentSessionId, connected,
  chatOpen, onChatToggle, unreadCount, onShare, onRun, onLeave,
}: Props) {
  function copyRoomId() {
    navigator.clipboard.writeText(roomId);
  }

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="toolbar-logo">
          <span className="logo-icon">⌨</span>
          <span className="logo-text">CollabCode</span>
        </div>
        <div className="toolbar-divider" />
        <div className="room-id-display">
          <span className="room-label">ROOM</span>
          <code className="room-id">{roomId.slice(0, 8)}</code>
          <button className="icon-btn" onClick={copyRoomId} title="Copy room ID">⧉</button>
        </div>
      </div>

      <div className="toolbar-center">
        <select
          className="lang-select"
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>

        <div className="font-size-control">
          <button className="icon-btn" onClick={() => onFontSizeChange(Math.max(10, fontSize - 1))}>−</button>
          <span className="font-size-label">{fontSize}px</span>
          <button className="icon-btn" onClick={() => onFontSizeChange(Math.min(24, fontSize + 1))}>+</button>
        </div>

        <button className="icon-btn" onClick={onThemeToggle} title="Toggle theme">
          {theme === 'dark' ? '☀' : '🌙'}
        </button>

        <button className="run-btn" onClick={onRun}>▶ Run</button>
      </div>

      <div className="toolbar-right">
        <div className={`conn-status ${connected ? 'connected' : 'disconnected'}`}>
          <span className="conn-dot" />
          <span className="conn-label">{connected ? 'Connected' : 'Reconnecting…'}</span>
        </div>

        <UserPresence users={users} currentSessionId={currentSessionId} />

        <button className="chat-toggle-btn" onClick={onChatToggle} title="Toggle chat">
          💬
          {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
        </button>

        <button className="share-btn" onClick={onShare}>Share</button>
        <button className="leave-btn" onClick={onLeave}>Leave</button>
      </div>
    </div>
  );
}
