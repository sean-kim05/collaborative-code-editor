import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import Editor from '../components/Editor/Editor';
import Toolbar from '../components/Toolbar/Toolbar';
import Chat from '../components/Chat/Chat';
import FileExplorer from '../components/FileExplorer/FileExplorer';
import StatusBar from '../components/StatusBar/StatusBar';
import LoadingScreen from '../components/LoadingScreen/LoadingScreen';
import ShareModal from '../components/ShareModal/ShareModal';
import { ToastContainer, useToasts } from '../components/Toast/Toast';
import type { User, RemoteCursor, ChatMessage } from '../types';
import { getUserColor } from '../utils/userColors';
import './Room.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

function getUsername(): string {
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
  const [users, setUsers] = useState<User[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<{ stdout: string; stderr: string; elapsed_ms: number } | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 });

  const { toasts, addToast, dismiss } = useToasts();
  const socketRef = useRef<Socket | null>(null);
  const usernameRef = useRef(getUsername());
  const colorRef = useRef(getUserColor(usernameRef.current));
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!roomId) return;
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      sessionIdRef.current = socket.id || null;
      socket.emit('join_room', { room_id: roomId, username: usernameRef.current, color: colorRef.current });
    });

    socket.on('disconnect', () => {
      setConnected(false);
      addToast('Connection lost, reconnecting…', 'warning');
    });

    socket.on('room_state', (data: { content: string; users: User[] }) => {
      setCode(data.content);
      setUsers(data.users);
      setLoading(false);
    });

    socket.on('user_list', (data: { users: User[] }) => setUsers(data.users));

    socket.on('user_joined', (user: User) => {
      addToast(`${user.username} joined the room`, 'info');
    });

    socket.on('user_left', (data: { session_id: string }) => {
      setRemoteCursors((prev) => prev.filter((c) => c.session_id !== data.session_id));
    });

    socket.on('code_change', (data: { content: string }) => setCode(data.content));

    socket.on('cursor_move', (data: { session_id: string; username: string; color: string; cursor_position: { lineNumber: number; column: number } }) => {
      setRemoteCursors((prev) => {
        const filtered = prev.filter((c) => c.session_id !== data.session_id);
        return [...filtered, { session_id: data.session_id, username: data.username, color: data.color, position: data.cursor_position }];
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
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); setChatOpen((o) => !o); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleRun(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [code, language]);

  function handleCodeChange(newCode: string) {
    setCode(newCode);
    socketRef.current?.emit('code_change', { room_id: roomId, content: newCode, username: usernameRef.current });
  }

  function handleCursorChange(position: { lineNumber: number; column: number }) {
    setCursorPos({ line: position.lineNumber, column: position.column });
    socketRef.current?.emit('cursor_move', { room_id: roomId, cursor_position: position, username: usernameRef.current, color: colorRef.current, session_id: sessionIdRef.current });
  }

  function handleSendMessage(message: string) {
    socketRef.current?.emit('send_message', { room_id: roomId, username: usernameRef.current, color: colorRef.current, message, timestamp: new Date().toISOString() });
  }

  function handleShare() {
    setShareOpen(true);
  }

  function handleLeave() {
    socketRef.current?.emit('leave_room', { room_id: roomId });
    navigate('/');
  }

  const handleRun = useCallback(async () => {
    if (language !== 'javascript' && language !== 'python') {
      addToast('Run supports JavaScript and Python only', 'warning');
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
      try { new Function(code)(); } catch (e: unknown) { errors.push(String(e)); }
      console.log = origLog; console.error = origErr;
      setOutput({ stdout: logs.join('\n'), stderr: errors.join('\n'), elapsed_ms: Math.round(performance.now() - start) });
    } else {
      try {
        const res = await fetch(`${SOCKET_URL}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'python', code }) });
        setOutput(await res.json());
      } catch { setOutput({ stdout: '', stderr: 'Failed to reach server', elapsed_ms: 0 }); }
    }
    setRunning(false);
  }, [code, language]);

  if (loading) return <LoadingScreen />;

  return (
    <div className="room">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {shareOpen && (
        <ShareModal
          roomId={roomId || ''}
          onClose={() => setShareOpen(false)}
          onCopied={() => addToast('Room link copied!', 'success')}
        />
      )}

      <Toolbar
        roomId={roomId || ''}
        language={language}
        onLanguageChange={setLanguage}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        users={users}
        currentSessionId={sessionIdRef.current || undefined}
        onShare={handleShare}
        onRun={handleRun}
        onLeave={handleLeave}
        onChatToggle={() => { setChatOpen((o) => !o); setUnreadCount(0); }}
        chatOpen={chatOpen}
        unreadCount={unreadCount}
        running={running}
      />

      {!welcomeDismissed && (
        <div className="welcome-banner">
          <span>👋 Welcome to CollabCode! Share the URL to invite others.</span>
          <button className="welcome-dismiss" onClick={() => setWelcomeDismissed(true)}>✕</button>
        </div>
      )}

      {!connected && (
        <div className="offline-banner">
          ⚠ You're offline. Changes will sync when reconnected.
        </div>
      )}

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
              theme="dark"
            />
          </div>

          {outputOpen && (
            <div className="output-panel">
              <div className="output-header">
                <span>Output</span>
                {output && <span className="output-time">{output.elapsed_ms}ms</span>}
                <button className="output-btn" onClick={() => setOutput(null)}>Clear</button>
                <button className="output-btn" onClick={() => setOutputOpen(false)}>✕</button>
              </div>
              <div className="output-body">
                {running && <div className="output-loading">Running…</div>}
                {output?.stdout && <pre className="output-stdout">{output.stdout}</pre>}
                {output?.stderr && <pre className="output-stderr">{output.stderr}</pre>}
                {output && !output.stdout && !output.stderr && <div className="output-empty">No output</div>}
              </div>
            </div>
          )}
        </div>

        {chatOpen && (
          <Chat
            messages={messages}
            onSend={handleSendMessage}
            onClose={() => setChatOpen(false)}
            currentUsername={usernameRef.current}
            userCount={users.length}
          />
        )}
      </div>

      <StatusBar language={language} connected={connected} line={cursorPos.line} column={cursorPos.column} />
    </div>
  );
}
