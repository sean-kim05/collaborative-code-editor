import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import Editor from '../components/Editor/Editor';
import Toolbar from '../components/Toolbar/Toolbar';
import Chat from '../components/Chat/Chat';
import FileExplorer from '../components/FileExplorer/FileExplorer';
import { User, RemoteCursor, ChatMessage } from '../types';
import { getUserColor } from '../utils/userColors';
import './Room.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

function getUsernameFromStorage(): string {
  const stored = localStorage.getItem('collab_username');
  if (stored) return stored;
  const name = prompt('Enter your name:') || `User${Math.floor(Math.random() * 1000)}`;
  localStorage.setItem('collab_username', name);
  return name;
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [fontSize, setFontSize] = useState(14);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [users, setUsers] = useState<User[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [output, setOutput] = useState<{ stdout: string; stderr: string; elapsed_ms: number } | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const usernameRef = useRef(getUsernameFromStorage());
  const colorRef = useRef(getUserColor(usernameRef.current));
  const sessionIdRef = useRef<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    if (!roomId) return;

    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      sessionIdRef.current = socket.id || null;
      socket.emit('join_room', {
        room_id: roomId,
        username: usernameRef.current,
        color: colorRef.current,
      });
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('room_state', (data: { content: string; users: User[] }) => {
      setCode(data.content);
      setUsers(data.users);
    });

    socket.on('user_list', (data: { users: User[] }) => setUsers(data.users));

    socket.on('user_joined', (user: User) => {
      showToast(`${user.username} joined`);
    });

    socket.on('user_left', (data: { session_id: string }) => {
      setRemoteCursors((prev) => prev.filter((c) => c.session_id !== data.session_id));
    });

    socket.on('code_change', (data: { content: string }) => {
      setCode(data.content);
    });

    socket.on('cursor_move', (data: { session_id: string; username: string; color: string; cursor_position: { lineNumber: number; column: number } }) => {
      setRemoteCursors((prev) => {
        const filtered = prev.filter((c) => c.session_id !== data.session_id);
        return [...filtered, {
          session_id: data.session_id,
          username: data.username,
          color: data.color,
          position: data.cursor_position,
        }];
      });
    });

    socket.on('new_message', (msg: ChatMessage) => {
      const withId = { ...msg, id: Math.random().toString(36).slice(2) };
      setMessages((prev) => [...prev, withId]);
      if (!chatOpen) setUnreadCount((n) => n + 1);
    });

    return () => {
      socket.emit('leave_room', { room_id: roomId });
      socket.disconnect();
    };
  }, [roomId]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setChatOpen((o) => !o);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleRun();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [code, language]);

  function handleCodeChange(newCode: string) {
    setCode(newCode);
    socketRef.current?.emit('code_change', {
      room_id: roomId,
      content: newCode,
      username: usernameRef.current,
    });
  }

  function handleCursorChange(position: { lineNumber: number; column: number }) {
    socketRef.current?.emit('cursor_move', {
      room_id: roomId,
      cursor_position: position,
      username: usernameRef.current,
      color: colorRef.current,
      session_id: sessionIdRef.current,
    });
  }

  function handleSendMessage(message: string) {
    const msg = {
      room_id: roomId,
      username: usernameRef.current,
      color: colorRef.current,
      message,
      timestamp: new Date().toISOString(),
    };
    socketRef.current?.emit('send_message', msg);
  }

  function handleShare() {
    navigator.clipboard.writeText(window.location.href);
    showToast('Room link copied!');
  }

  function handleLeave() {
    socketRef.current?.emit('leave_room', { room_id: roomId });
    navigate('/');
  }

  async function handleRun() {
    if (language !== 'javascript' && language !== 'python') {
      showToast('Run is supported for JavaScript and Python only');
      return;
    }
    setRunning(true);
    setOutputOpen(true);
    setOutput(null);

    if (language === 'javascript') {
      const start = performance.now();
      const logs: string[] = [];
      const errors: string[] = [];
      const origLog = console.log;
      const origErr = console.error;
      console.log = (...args) => logs.push(args.join(' '));
      console.error = (...args) => errors.push(args.join(' '));
      try {
        // eslint-disable-next-line no-new-func
        new Function(code)();
      } catch (e: unknown) {
        errors.push(String(e));
      }
      console.log = origLog;
      console.error = origErr;
      setOutput({ stdout: logs.join('\n'), stderr: errors.join('\n'), elapsed_ms: Math.round(performance.now() - start) });
    } else {
      try {
        const res = await fetch(`${SOCKET_URL}/api/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: 'python', code }),
        });
        const data = await res.json();
        setOutput(data);
      } catch {
        setOutput({ stdout: '', stderr: 'Failed to reach server', elapsed_ms: 0 });
      }
    }
    setRunning(false);
  }

  return (
    <div className={`room ${theme}`}>
      {toast && <div className="toast">{toast}</div>}

      <Toolbar
        roomId={roomId || ''}
        language={language}
        onLanguageChange={setLanguage}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        theme={theme}
        onThemeToggle={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}
        users={users}
        currentSessionId={sessionIdRef.current || undefined}
        connected={connected}
        chatOpen={chatOpen}
        onChatToggle={() => { setChatOpen((o) => !o); setUnreadCount(0); }}
        unreadCount={unreadCount}
        onShare={handleShare}
        onRun={handleRun}
        onLeave={handleLeave}
      />

      <div className="room-body">
        <FileExplorer language={language} roomId={roomId || ''} />

        <div className="editor-area">
          <div className="editor-main">
            <Editor
              value={code}
              onChange={handleCodeChange}
              onCursorChange={handleCursorChange}
              remoteCursors={remoteCursors}
              language={language}
              fontSize={fontSize}
              theme={theme}
            />
          </div>

          {outputOpen && (
            <div className="output-panel">
              <div className="output-header">
                <span>Output</span>
                {output && <span className="output-time">{output.elapsed_ms}ms</span>}
                <button className="icon-btn" onClick={() => setOutput(null)}>Clear</button>
                <button className="icon-btn" onClick={() => setOutputOpen(false)}>✕</button>
              </div>
              <div className="output-body">
                {running && <div className="output-loading">Running…</div>}
                {output && output.stdout && <pre className="output-stdout">{output.stdout}</pre>}
                {output && output.stderr && <pre className="output-stderr">{output.stderr}</pre>}
                {output && !output.stdout && !output.stderr && <div className="output-empty">No output</div>}
              </div>
            </div>
          )}
        </div>

        {chatOpen && (
          <div className="chat-sidebar">
            <Chat
              messages={messages}
              onSend={handleSendMessage}
              currentUsername={usernameRef.current}
            />
          </div>
        )}
      </div>
    </div>
  );
}
