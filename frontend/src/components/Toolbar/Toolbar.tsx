import { useState } from 'react';
import { Code2, Copy, Check, ChevronDown, Sparkles, History, MessageSquare, Share2, Play, LogOut, Minus, Plus } from 'lucide-react';
import UserPresence from '../UserPresence/UserPresence';
import type { User } from '../../types';
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
  users: User[];
  currentSessionId?: string;
  onShare: () => void;
  onRun: () => void;
  onLeave: () => void;
  onChatToggle: () => void;
  chatOpen: boolean;
  unreadCount: number;
  running: boolean;
  onAIToggle: () => void;
  aiOpen: boolean;
  onHistoryToggle: () => void;
  historyOpen: boolean;
}

export default function Toolbar({
  roomId, language, onLanguageChange, fontSize, onFontSizeChange,
  users, currentSessionId, onShare, onRun, onLeave,
  onChatToggle, unreadCount, running,
  onAIToggle, aiOpen, onHistoryToggle, historyOpen,
}: Props) {
  const [langOpen, setLangOpen] = useState(false);
  const [roomCopied, setRoomCopied] = useState(false);

  function copyRoomId() {
    navigator.clipboard.writeText(roomId);
    setRoomCopied(true);
    setTimeout(() => setRoomCopied(false), 1500);
  }

  const currentLang = LANGUAGES.find((l) => l.value === language)?.label || language;

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="tb-logo">
          <div className="tb-logo-icon"><Code2 size={14} /></div>
          <span className="tb-logo-text">CollabCode</span>
        </div>
        <div className="tb-sep" />
        <button className="room-pill" onClick={copyRoomId} title="Copy room ID">
          <span className="room-pill-id">{roomId.slice(0, 8)}</span>
          <span className="room-pill-copy">
            {roomCopied ? <Check size={11} /> : <Copy size={11} />}
          </span>
        </button>
      </div>

      <div className="toolbar-center">
        <div className="lang-picker">
          <button className="lang-btn" onClick={() => setLangOpen((o) => !o)}>
            <span>{currentLang}</span>
            <ChevronDown size={12} className="lang-chevron" />
          </button>
          {langOpen && (
            <div className="lang-dropdown">
              {LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  className={`lang-option ${l.value === language ? 'active' : ''}`}
                  onClick={() => { onLanguageChange(l.value); setLangOpen(false); }}
                >
                  {l.label}
                  {l.value === language && <Check size={11} className="lang-check" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="font-ctrl">
          <button className="font-btn" onClick={() => onFontSizeChange(Math.max(10, fontSize - 1))}><Minus size={12} /></button>
          <span className="font-val">{fontSize}</span>
          <button className="font-btn" onClick={() => onFontSizeChange(Math.min(24, fontSize + 1))}><Plus size={12} /></button>
        </div>
      </div>

      <div className="toolbar-right">
        <UserPresence users={users} currentSessionId={currentSessionId} />
        <div className="tb-sep" />

        <button
          className={`tb-btn ${aiOpen ? 'tb-btn-active' : ''}`}
          onClick={onAIToggle}
          title="AI Assistant (Ctrl+I)"
        >
          <Sparkles size={15} />
        </button>

        <button
          className={`tb-btn ${historyOpen ? 'tb-btn-active' : ''}`}
          onClick={onHistoryToggle}
          title="Version History"
        >
          <History size={15} />
        </button>

        <button className="tb-btn" onClick={onChatToggle} title="Chat (Ctrl+/)">
          <MessageSquare size={15} />
          {unreadCount > 0 && <span className="tb-badge">{unreadCount}</span>}
        </button>

        <button className="tb-share-btn" onClick={onShare}>
          <Share2 size={13} /> Share
        </button>

        <button className={`tb-run-btn ${running ? 'running' : ''}`} onClick={onRun} disabled={running} title="Run (Ctrl+Enter)">
          {running ? <span className="run-spinner" /> : <Play size={12} />}
          {running ? 'Running…' : 'Run'}
        </button>

        <button className="tb-leave-btn" onClick={onLeave}>
          <LogOut size={13} /> Leave
        </button>
      </div>
    </div>
  );
}
