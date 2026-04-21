import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import Editor from '../components/Editor/Editor';
import type { EditorHandle } from '../components/Editor/Editor';
import Toolbar from '../components/Toolbar/Toolbar';
import Chat from '../components/Chat/Chat';
import FileExplorer from '../components/FileExplorer/FileExplorer';
import StatusBar from '../components/StatusBar/StatusBar';
import LoadingScreen from '../components/LoadingScreen/LoadingScreen';
import ShareModal from '../components/ShareModal/ShareModal';
import AIAssistant from '../components/AIAssistant/AIAssistant';
import VersionHistory from '../components/VersionHistory/VersionHistory';
import { ToastContainer, useToasts } from '../components/Toast/Toast';
import type { User, RemoteCursor, RemoteSelection, ChatMessage, FileSystem, TypingUser } from '../types';
import { getUserColor } from '../utils/userColors';
import './Room.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';
const AUTO_SNAPSHOT_INTERVAL = 2 * 60 * 1000;

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

  const [fs, setFs] = useState<FileSystem>({ files: [], activeFileId: '' });
  const fsRef = useRef<FileSystem>({ files: [], activeFileId: '' });

  const activeFile = fs.files.find(f => f.id === fs.activeFileId) || fs.files[0];
  const activeCode = activeFile?.content || '';
  const activeLanguage = activeFile?.language || 'javascript';

  const [language, setLanguage] = useState('javascript');
  const [fontSize, setFontSize] = useState(14);
  const [users, setUsers] = useState<User[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [remoteSelections, setRemoteSelections] = useState<RemoteSelection[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<{ stdout: string; stderr: string; elapsed_ms: number } | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [outputHeight, setOutputHeight] = useState(200);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 });
  const [aiOpen, setAiOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [currentSelection, setCurrentSelection] = useState('');
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);

  const { toasts, addToast, dismiss } = useToasts();
  const socketRef = useRef<Socket | null>(null);
  const usernameRef = useRef(getUsername());
  const colorRef = useRef(getUserColor(usernameRef.current));
  const sessionIdRef = useRef<string | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSnapshotRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outputDragRef = useRef<{ startY: number; startH: number } | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dynamic page title
  useEffect(() => {
    document.title = roomId ? `CollabCode — ${roomId}` : 'CollabCode';
    return () => { document.title = 'CollabCode'; };
  }, [roomId]);

  // Sync language selector when active file changes
  useEffect(() => {
    if (activeFile?.language) setLanguage(activeFile.language);
  }, [fs.activeFileId]);

  // Keep fsRef in sync for socket callbacks
  useEffect(() => { fsRef.current = fs; }, [fs]);

  // Auto-snapshot every 2 minutes
  useEffect(() => {
    if (!roomId) return;
    autoSnapshotRef.current = setInterval(async () => {
      const cur = fsRef.current;
      const file = cur.files.find(f => f.id === cur.activeFileId) || cur.files[0];
      if (!file) return;
      await fetch(`${SOCKET_URL}/api/snapshots/${roomId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: file.id, file_name: file.name, content: file.content }),
      });
    }, AUTO_SNAPSHOT_INTERVAL);
    return () => { if (autoSnapshotRef.current) clearInterval(autoSnapshotRef.current); };
  }, [roomId]);

  // Room exists check + socket setup
  useEffect(() => {
    if (!roomId) return;

    // 10s loading timeout
    loadTimeoutRef.current = setTimeout(() => {
      setLoadError('Server unavailable — could not connect. Is the backend running?');
      setLoading(false);
    }, 10000);

    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      setConnected(true);
      sessionIdRef.current = socket.id || null;
      socket.emit('join_room', { room_id: roomId, username: usernameRef.current, color: colorRef.current });
    });

    socket.on('connect_error', () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      setLoadError('Server unavailable — trying to reconnect…');
      setLoading(false);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      addToast('Connection lost, reconnecting…', 'warning');
    });

    socket.on('join_error', (data: { message: string }) => {
      addToast(data.message, 'error');
      navigate('/');
    });

    socket.on('room_state', (data: { fs: FileSystem; users: User[] }) => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      setFs(data.fs);
      setUsers(data.users);
      if (data.fs.files[0]) setLanguage(data.fs.files[0].language);
      setLoading(false);
      setLoadError(null);
    });

    socket.on('user_list', (data: { users: User[] }) => setUsers(data.users));

    socket.on('user_joined', (user: User) => {
      addToast(`${user.username} joined`, 'info');
    });

    socket.on('user_left', (data: { session_id: string }) => {
      setRemoteCursors(prev => prev.filter(c => c.session_id !== data.session_id));
      setRemoteSelections(prev => prev.filter(s => s.session_id !== data.session_id));
      setTypingUsers(prev => prev.filter(u => u.session_id !== data.session_id));
      setFollowingUserId(prev => prev === data.session_id ? null : prev);
    });

    socket.on('code_change', (data: { file_id: string; content: string }) => {
      setFs(prev => {
        const files = prev.files.map(f => f.id === data.file_id ? { ...f, content: data.content } : f);
        return { ...prev, files };
      });
    });

    socket.on('fs_update', (data: { fs: FileSystem }) => {
      setFs(data.fs);
    });

    socket.on('cursor_move', (data: { session_id: string; username: string; color: string; cursor_position: { lineNumber: number; column: number } }) => {
      setRemoteCursors(prev => {
        const filtered = prev.filter(c => c.session_id !== data.session_id);
        return [...filtered, { session_id: data.session_id, username: data.username, color: data.color, position: data.cursor_position }];
      });
      // Follow mode: scroll editor to followed user's cursor
      setFollowingUserId(prevFollowing => {
        if (prevFollowing === data.session_id && editorRef.current) {
          editorRef.current.revealLine(data.cursor_position.lineNumber);
        }
        return prevFollowing;
      });
    });

    socket.on('selection_change', (data: { session_id: string; username: string; color: string; startLine: number; startColumn: number; endLine: number; endColumn: number }) => {
      setRemoteSelections(prev => {
        const filtered = prev.filter(s => s.session_id !== data.session_id);
        if (data.startLine === data.endLine && data.startColumn === data.endColumn) return filtered;
        return [...filtered, data];
      });
    });

    socket.on('typing', (data: { session_id: string; username: string; color: string; isTyping: boolean }) => {
      setTypingUsers(prev => {
        const filtered = prev.filter(u => u.session_id !== data.session_id);
        if (data.isTyping) return [...filtered, { session_id: data.session_id, username: data.username, color: data.color }];
        return filtered;
      });
    });

    socket.on('new_message', (msg: ChatMessage) => {
      const withId = { ...msg, id: Math.random().toString(36).slice(2) };
      setMessages(prev => [...prev, withId]);
      if (!chatOpen) setUnreadCount(n => n + 1);
    });

    return () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      socket.emit('leave_room', { room_id: roomId });
      socket.disconnect();
    };
  }, [roomId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); setChatOpen(o => !o); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleRun(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); setAiOpen(o => !o); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveManualSnapshot(); }
      if (e.key === 'Escape') setFollowingUserId(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeCode, activeFile]);

  function handleCodeChange(newCode: string) {
    const fileId = fs.activeFileId;
    setFs(prev => ({
      ...prev,
      files: prev.files.map(f => f.id === fileId ? { ...f, content: newCode, unsaved: true } : f),
    }));
    socketRef.current?.emit('code_change', { room_id: roomId, file_id: fileId, content: newCode });

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    socketRef.current?.emit('typing', { room_id: roomId, session_id: sessionIdRef.current, username: usernameRef.current, color: colorRef.current, isTyping: true });
    typingTimerRef.current = setTimeout(() => {
      socketRef.current?.emit('typing', { room_id: roomId, session_id: sessionIdRef.current, username: usernameRef.current, color: colorRef.current, isTyping: false });
    }, 1500);
  }

  function handleCursorChange(position: { lineNumber: number; column: number }) {
    setCursorPos({ line: position.lineNumber, column: position.column });
    socketRef.current?.emit('cursor_move', { room_id: roomId, cursor_position: position, username: usernameRef.current, color: colorRef.current, session_id: sessionIdRef.current });
  }

  function handleSelectionChange(sel: string) {
    setCurrentSelection(sel);
  }

  function handleSwitchFile(fileId: string) {
    setFs(prev => ({ ...prev, activeFileId: fileId }));
    const file = fs.files.find(f => f.id === fileId);
    if (file) setLanguage(file.language);
    socketRef.current?.emit('switch_file', { room_id: roomId, file_id: fileId, session_id: sessionIdRef.current });
  }

  function handleCreateFile(name: string, lang: string) {
    socketRef.current?.emit('create_file', { room_id: roomId, name, language: lang });
  }

  function handleDeleteFile(fileId: string) {
    socketRef.current?.emit('delete_file', { room_id: roomId, file_id: fileId });
  }

  function handleRenameFile(fileId: string, name: string) {
    socketRef.current?.emit('rename_file', { room_id: roomId, file_id: fileId, name });
  }

  function handleSendMessage(message: string) {
    socketRef.current?.emit('send_message', { room_id: roomId, username: usernameRef.current, color: colorRef.current, message, timestamp: new Date().toISOString() });
  }

  async function saveManualSnapshot() {
    if (!activeFile) return;
    await fetch(`${SOCKET_URL}/api/snapshots/${roomId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: activeFile.id, file_name: activeFile.name, content: activeCode, label: 'Manual save' }),
    });
    addToast('Checkpoint saved', 'success');
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
      console.log = (...args) => logs.push(args.map(String).join(' '));
      console.error = (...args) => errors.push(args.map(String).join(' '));
      try {
        const fn = new Function(activeCode);
        const result = fn();
        if (result instanceof Promise) await Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(new Error('Async timeout (5s)')), 5000))]);
      } catch (e: unknown) { errors.push(String(e)); }
      console.log = origLog; console.error = origErr;
      setOutput({ stdout: logs.join('\n'), stderr: errors.join('\n'), elapsed_ms: Math.round(performance.now() - start) });
    } else {
      try {
        const res = await fetch(`${SOCKET_URL}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'python', code: activeCode }) });
        setOutput(await res.json());
      } catch {
        setOutput({ stdout: '', stderr: 'Could not reach execution server', elapsed_ms: 0 });
      }
    }
    setRunning(false);
  }, [activeCode, language]);

  function handleApplyAI(code: string) {
    const fileId = fs.activeFileId;
    if (editorRef.current) {
      editorRef.current.applyText(code);
    } else {
      setFs(prev => ({
        ...prev,
        files: prev.files.map(f => f.id === fileId ? { ...f, content: code, unsaved: true } : f),
      }));
    }
    addToast('AI suggestion applied', 'success');
  }

  function handleRestoreSnapshot(content: string) {
    const fileId = fs.activeFileId;
    setFs(prev => ({
      ...prev,
      files: prev.files.map(f => f.id === fileId ? { ...f, content, unsaved: true } : f),
    }));
    socketRef.current?.emit('code_change', { room_id: roomId, file_id: fileId, content });
    addToast('Snapshot restored', 'success');
  }

  function startOutputDrag(e: React.MouseEvent) {
    outputDragRef.current = { startY: e.clientY, startH: outputHeight };
    const onMove = (ev: MouseEvent) => {
      if (!outputDragRef.current) return;
      const delta = outputDragRef.current.startY - ev.clientY;
      setOutputHeight(Math.max(80, Math.min(500, outputDragRef.current.startH + delta)));
    };
    const onUp = () => { outputDragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const followingUser = users.find(u => u.session_id === followingUserId) ?? null;

  if (loading) return <LoadingScreen />;

  if (loadError) {
    return (
      <div className="room-error">
        <div className="room-error-icon">⚠</div>
        <div className="room-error-title">Could not connect</div>
        <div className="room-error-msg">{loadError}</div>
        <div className="room-error-actions">
          <button className="room-error-btn" onClick={() => window.location.reload()}>Try again</button>
          <button className="room-error-ghost" onClick={() => navigate('/')}>Go home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="room">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {shareOpen && (
        <ShareModal roomId={roomId || ''} onClose={() => setShareOpen(false)} onCopied={() => addToast('Link copied!', 'success')} />
      )}

      <Toolbar
        roomId={roomId || ''}
        language={language}
        onLanguageChange={(lang) => {
          setLanguage(lang);
          const fileId = fs.activeFileId;
          socketRef.current?.emit('update_file_language', { room_id: roomId, file_id: fileId, language: lang });
        }}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        users={users}
        currentSessionId={sessionIdRef.current || undefined}
        onShare={() => setShareOpen(true)}
        onRun={handleRun}
        onLeave={() => { socketRef.current?.emit('leave_room', { room_id: roomId }); navigate('/'); }}
        onChatToggle={() => { setChatOpen(o => !o); setUnreadCount(0); }}
        chatOpen={chatOpen}
        unreadCount={unreadCount}
        running={running}
        onAIToggle={() => setAiOpen(o => !o)}
        aiOpen={aiOpen}
        onHistoryToggle={() => setHistoryOpen(o => !o)}
        historyOpen={historyOpen}
        followingUser={followingUser}
        onFollow={(sid) => setFollowingUserId(sid)}
        onStopFollow={() => setFollowingUserId(null)}
      />

      {!welcomeDismissed && (
        <div className="welcome-banner">
          <span>Welcome to CollabCode! Share the URL to invite collaborators. Press Ctrl+I for AI assistant, Ctrl+S to save checkpoint.</span>
          <button className="welcome-dismiss" onClick={() => setWelcomeDismissed(true)}>✕</button>
        </div>
      )}

      {!connected && (
        <div className="offline-banner">⚠ You're offline. Changes will sync when reconnected.</div>
      )}

      {typingUsers.length > 0 && (
        <div className="typing-banner">
          {typingUsers.map((u, i) => (
            <span key={u.session_id} style={{ color: u.color }}>
              {u.username}{i < typingUsers.length - 1 ? ', ' : ''}
            </span>
          ))}
          {' '}
          {typingUsers.length === 1 ? 'is typing…' : 'are typing…'}
        </div>
      )}

      <div className="room-body">
        <FileExplorer
          files={fs.files}
          activeFileId={fs.activeFileId}
          users={users}
          currentSessionId={sessionIdRef.current || undefined}
          onSwitchFile={handleSwitchFile}
          onCreateFile={handleCreateFile}
          onDeleteFile={handleDeleteFile}
          onRenameFile={handleRenameFile}
        />

        <div className="editor-area">
          <div className="editor-tabs">
            {fs.files.map(file => (
              <div
                key={file.id}
                className={`editor-tab ${file.id === fs.activeFileId ? 'active' : ''}`}
                onClick={() => handleSwitchFile(file.id)}
              >
                <span className="editor-tab-name">{file.name}</span>
                {file.unsaved && <span className="editor-tab-dot" />}
              </div>
            ))}
          </div>

          <div className={`editor-main ${followingUserId ? 'editor-following' : ''}`}>
            <Editor
              ref={editorRef}
              value={activeCode}
              onChange={handleCodeChange}
              onCursorChange={handleCursorChange}
              onSelectionChange={handleSelectionChange}
              remoteCursors={remoteCursors}
              remoteSelections={remoteSelections}
              language={activeLanguage}
              fontSize={fontSize}
              theme="dark"
            />
          </div>

          {outputOpen && (
            <div className="output-panel" style={{ height: outputHeight }}>
              <div className="output-resize-handle" onMouseDown={startOutputDrag} />
              <div className="output-header">
                <span>Output</span>
                {output && <span className="output-time">{output.elapsed_ms}ms</span>}
                {running && <span className="output-running">● Running</span>}
                <button className="output-btn" onClick={() => setOutput(null)}>Clear</button>
                <button className="output-btn" onClick={() => setOutputOpen(false)}>✕</button>
              </div>
              <div className="output-body">
                {running && !output && <div className="output-loading">Running…</div>}
                {output?.stdout && <pre className="output-stdout">{output.stdout}</pre>}
                {output?.stderr && <pre className="output-stderr">{output.stderr}</pre>}
                {output && !output.stdout && !output.stderr && <div className="output-empty">No output</div>}
              </div>
            </div>
          )}
        </div>

        {aiOpen && (
          <AIAssistant
            code={activeCode}
            selection={currentSelection}
            language={activeLanguage}
            onApply={handleApplyAI}
            onClose={() => setAiOpen(false)}
          />
        )}

        {historyOpen && (
          <VersionHistory
            roomId={roomId || ''}
            currentCode={activeCode}
            currentFileName={activeFile?.name || 'main.js'}
            currentFileId={activeFile?.id || ''}
            onRestore={handleRestoreSnapshot}
            onClose={() => setHistoryOpen(false)}
          />
        )}

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

      <StatusBar language={activeLanguage} connected={connected} line={cursorPos.line} column={cursorPos.column} />
    </div>
  );
}
