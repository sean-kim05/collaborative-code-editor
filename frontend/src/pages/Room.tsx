/**
 * Room — the collaborative editing session. The one stateful page in the app.
 *
 * Architecture: this component owns the socket and *all* room state, and passes
 * it down as props. Editor, FileExplorer, Chat, Toolbar and the panels are
 * presentational — they render props and call callbacks, they don't talk to the
 * network. One component owning the connection means there's exactly one place
 * where server events turn into React state, which keeps the data flow
 * traceable (and avoids several components racing to own the same socket).
 *
 * The three patterns worth knowing when reading this file:
 *
 *  1. **Refs alongside state for socket callbacks.** Socket handlers are
 *     registered once (the effect keys on `roomId`) so they close over the
 *     state from *that* render forever. Anything a handler needs to read live
 *     is mirrored into a ref — see `fsRef` — or read via a functional setter.
 *
 *  2. **Optimistic local, broadcast remote.** Typing applies to local state
 *     immediately and emits in the same breath; we never wait for a server
 *     round trip to show your own keystrokes.
 *
 *  3. **Server owns the file tree, client owns the view.** File contents and
 *     structure come from `fs_update`/`room_state`; which tab you're looking at,
 *     panel sizes, and follow mode are local-only.
 */
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
import { addRecentRoom } from '../utils/recentRooms';
import { runPython, isPythonWarm } from '../lib/pythonRunner';
import './Room.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';
const AUTO_SNAPSHOT_INTERVAL = 2 * 60 * 1000;

/**
 * Resolve the display name, prompting once and remembering it in localStorage.
 *
 * Identity for this app is deliberately this thin — no accounts, no login, so a
 * shared link is all it takes to collaborate. The random fallback guarantees a
 * non-empty name even if the user dismisses the prompt.
 */
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

  // The file tree, mirrored to a ref. `fs` drives rendering; `fsRef` is what
  // long-lived callbacks (the auto-snapshot interval) read so they see current
  // data instead of a snapshot of the render they were created in.
  const [fs, setFs] = useState<FileSystem>({ files: [], activeFileId: '' });
  const fsRef = useRef<FileSystem>({ files: [], activeFileId: '' });

  // Derived, not stored — one source of truth. Storing the active file
  // separately would mean keeping two copies of its content in sync on every
  // keystroke. The `|| files[0]` fallback covers the frame after a delete.
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
  const pendingUploadRef = useRef<{ name: string; content: string } | null>(null);

  // Dynamic page title + recent rooms tracking
  useEffect(() => {
    document.title = roomId ? `CollabCode — ${roomId}` : 'CollabCode';
    if (roomId) addRecentRoom(roomId);
    return () => { document.title = 'CollabCode'; };
  }, [roomId]);

  // Sync language selector when active file changes
  useEffect(() => {
    if (activeFile?.language) setLanguage(activeFile.language);
  }, [fs.activeFileId]);

  // Keep fsRef in sync for socket callbacks
  useEffect(() => { fsRef.current = fs; }, [fs]);

  // Auto-snapshot every 2 minutes.
  //
  // Keyed on `roomId` alone so the interval isn't torn down and rebuilt on
  // every keystroke — which is exactly why the callback must read `fsRef`
  // rather than `fs`: the closure is created once and would otherwise keep
  // POSTing the empty tree from mount time forever.
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

  /**
   * Socket lifecycle — connect, subscribe to every server event, tear down.
   *
   * Runs once per room (deps: `[roomId]`), which is the whole design: one
   * connection per session, handlers registered exactly once. The cost is that
   * every handler below closes over first-render state, so anything that needs
   * live values uses a ref or a functional state updater. Adding more deps here
   * would reconnect the socket mid-session, which is worse.
   *
   * The cleanup emits `leave_room` *before* `disconnect` so peers get an
   * immediate, clean departure instead of waiting on the server's disconnect
   * detection.
   */
  useEffect(() => {
    if (!roomId) return;

    // Watchdog: Socket.IO retries a dead server indefinitely without ever
    // firing an error we can show, so the user would sit on a spinner forever.
    // Every path that proves the connection works clears this.
    loadTimeoutRef.current = setTimeout(() => {
      setLoadError('Server unavailable — could not connect. Is the backend running?');
      setLoading(false);
    }, 10000);

    // WebSocket first, HTTP long-polling as the fallback for networks that
    // block upgrades (corporate proxies). Socket.IO handles the negotiation.
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    // Joining is done here rather than at render time because the socket id
    // doesn't exist until the connection is up — and that id is how every peer
    // addresses this user's cursor and presence. Re-fires automatically on
    // reconnect, which re-joins the room for free.
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

    // The handshake reply: full tree + roster, sent only to us. This is the
    // event that ends the loading state — not `connect`, since a live socket
    // with no room data yet has nothing to render.
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

    // A departure has to clear every trace of that user, or their cursor and
    // typing indicator hang around as ghosts. Also drops follow mode if we were
    // following them — otherwise the editor is pinned to a user who's gone.
    socket.on('user_left', (data: { session_id: string }) => {
      setRemoteCursors(prev => prev.filter(c => c.session_id !== data.session_id));
      setRemoteSelections(prev => prev.filter(s => s.session_id !== data.session_id));
      setTypingUsers(prev => prev.filter(u => u.session_id !== data.session_id));
      setFollowingUserId(prev => prev === data.session_id ? null : prev);
    });

    // A peer's edit. Patched by `file_id`, not into the active file — edits to
    // files you aren't looking at still land, so switching tabs shows current
    // content rather than whatever it held when you last opened it.
    //
    // The functional `setFs(prev => ...)` is load-bearing: this handler was
    // created on mount, so a direct `setFs({...fs})` would write a stale tree.
    socket.on('code_change', (data: { file_id: string; content: string }) => {
      setFs(prev => {
        const files = prev.files.map(f => f.id === data.file_id ? { ...f, content: data.content } : f);
        return { ...prev, files };
      });
    });

    // Structural change (create/delete/rename). The server sends the whole tree
    // and we replace wholesale — no merging, the server is authoritative here.
    //
    // This also completes the two-phase file upload. Uploads can't be done in
    // one shot because file ids are minted server-side: we ask for an empty
    // file, wait for the tree to come back, find our file by name, then push its
    // contents through the normal `code_change` path. `pendingUploadRef` is the
    // handoff between the two phases.
    socket.on('fs_update', (data: { fs: FileSystem }) => {
      setFs(data.fs);
      // After a file upload: find the newly created file by name, then push its content
      if (pendingUploadRef.current) {
        const { name, content } = pendingUploadRef.current;
        const newFile = data.fs.files.find(f => f.name === name);
        if (newFile) {
          pendingUploadRef.current = null;
          socket.emit('code_change', { room_id: roomId, file_id: newFile.id, content });
          setFs(prev => ({
            ...prev,
            files: prev.files.map(f => f.id === newFile.id ? { ...f, content } : f),
            activeFileId: newFile.id,
          }));
          addToast(`Uploaded ${name}`, 'success');
        }
      }
    });

    socket.on('cursor_move', (data: { session_id: string; username: string; color: string; cursor_position: { lineNumber: number; column: number } }) => {
      setRemoteCursors(prev => {
        const filtered = prev.filter(c => c.session_id !== data.session_id);
        return [...filtered, { session_id: data.session_id, username: data.username, color: data.color, position: data.cursor_position }];
      });
      // Follow mode (Figma-style): if this cursor belongs to the user we're
      // following, scroll to it. Reading `followingUserId` through a functional
      // setter is a deliberate trick — it's the only way to see the *current*
      // value from inside a handler registered on mount. Nothing is updated;
      // `prevFollowing` is returned unchanged, we just needed to read it.
      setFollowingUserId(prevFollowing => {
        if (prevFollowing === data.session_id && editorRef.current) {
          editorRef.current.revealLine(data.cursor_position.lineNumber);
        }
        return prevFollowing;
      });
    });

    // One selection per user, replaced on each update. A collapsed range means
    // "deselected" — we drop it instead of rendering a zero-width highlight.
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
      // Messages aren't persisted server-side and carry no id, so we mint one
      // locally for React's key.
      const withId = { ...msg, id: Math.random().toString(36).slice(2) };
      setMessages(prev => [...prev, withId]);
      // NOTE: `chatOpen` here is the mount-time value (false) — this handler
      // closes over first-render state like the others, but unlike them it
      // reads a plain variable instead of a ref or functional setter. So the
      // badge also counts messages that arrive while the chat is already open.
      // Minor cosmetic bug; the fix is a `chatOpenRef` mirror.
      if (!chatOpen) setUnreadCount(n => n + 1);
    });

    return () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      socket.emit('leave_room', { room_id: roomId });
      socket.disconnect();
    };
  }, [roomId]);

  /**
   * Global keyboard shortcuts (Ctrl/Cmd + Enter/I/S//, and Escape).
   *
   * Bound to `window` rather than the editor so they work whichever panel has
   * focus. `preventDefault` is what stops Ctrl+S from opening the browser's
   * save dialog and Ctrl+/ from hitting a browser default.
   *
   * Deps are `[activeCode, activeFile]` because `handleRun` and
   * `saveManualSnapshot` close over them — without the rebind, Ctrl+S would
   * checkpoint whatever the file contained when the room loaded.
   */
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

  /**
   * Every keystroke in the editor. The hottest path in the app.
   *
   * Local state updates and the emit fire together — no debounce on the edit
   * itself. That's the deliberate call behind the sub-20ms sync number: waiting
   * even 50ms to batch would be visible as lag in someone else's editor, and
   * the payload is small enough that per-keystroke messages are affordable.
   *
   * The typing indicator *is* debounced, and inverted: "typing" is sent
   * immediately on the first keystroke, and a 1.5s timer (reset on each
   * subsequent key) sends the "stopped" signal. So one event per typing burst
   * rather than one per character.
   */
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

  /** Caret moved: update the status bar and tell peers, so they can draw our
   *  cursor (and follow it, if they're following us). Unthrottled — cursor
   *  events are tiny and the server does nothing but relay them. */
  function handleCursorChange(position: { lineNumber: number; column: number }) {
    setCursorPos({ line: position.lineNumber, column: position.column });
    socketRef.current?.emit('cursor_move', { room_id: roomId, cursor_position: position, username: usernameRef.current, color: colorRef.current, session_id: sessionIdRef.current });
  }

  function handleSelectionChange(sel: string) {
    setCurrentSelection(sel);
  }

  /** Change tabs. Applied locally at once (the tree is already loaded, so there
   *  is nothing to fetch) and announced to peers as presence only — it does not
   *  move anyone else's editor. */
  function handleSwitchFile(fileId: string) {
    setFs(prev => ({ ...prev, activeFileId: fileId }));
    const file = fs.files.find(f => f.id === fileId);
    if (file) setLanguage(file.language);
    socketRef.current?.emit('switch_file', { room_id: roomId, file_id: fileId, session_id: sessionIdRef.current });
  }

  // Structural mutations are fire-and-forget: no local state change, the UI
  // updates when the server's `fs_update` lands. Unlike text edits these are
  // rare and need a server-assigned id, so the round trip isn't worth
  // optimistically faking.
  function handleCreateFile(name: string, lang: string) {
    socketRef.current?.emit('create_file', { room_id: roomId, name, language: lang });
  }

  function handleDeleteFile(fileId: string) {
    socketRef.current?.emit('delete_file', { room_id: roomId, file_id: fileId });
  }

  function handleRenameFile(fileId: string, name: string) {
    socketRef.current?.emit('rename_file', { room_id: roomId, file_id: fileId, name });
  }

  /** Phase 1 of the upload: stash the payload, then request an empty file.
   *  Phase 2 runs in the `fs_update` handler once the server hands back an id. */
  function handleUploadFile(name: string, lang: string, content: string) {
    pendingUploadRef.current = { name, content };
    socketRef.current?.emit('create_file', { room_id: roomId, name, language: lang });
  }

  function handleSendMessage(message: string) {
    socketRef.current?.emit('send_message', { room_id: roomId, username: usernameRef.current, color: colorRef.current, message, timestamp: new Date().toISOString() });
  }

  /** Ctrl+S — checkpoint the active file. Labelled, so it's distinguishable
   *  from the 2-minute automatic ones in the history list. */
  async function saveManualSnapshot() {
    if (!activeFile) return;
    await fetch(`${SOCKET_URL}/api/snapshots/${roomId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: activeFile.id, file_name: activeFile.name, content: activeCode, label: 'Manual save' }),
    });
    addToast('Checkpoint saved', 'success');
  }

  /**
   * Run the active file. Two completely different execution paths.
   *
   * **JavaScript — in the browser.** `new Function(code)` compiles and runs the
   * snippet with zero latency and zero server load, and `console.log`/`error`
   * are monkey-patched around the call so output can be captured and shown in
   * the panel. Honest caveats: this is *not* a sandbox — the code shares the
   * page's globals and DOM — and it runs on the main thread, so an infinite
   * loop freezes the tab (the 5s race only bounds returned promises, it can't
   * interrupt synchronous code). A Web Worker with a terminate-on-timeout would
   * fix both, at the cost of losing direct console capture.
   *
   * **Python — in a Web Worker.** Pyodide (CPython on WebAssembly) runs the
   * snippet in the user's own tab against an in-memory virtual filesystem. It
   * used to POST to `/api/run`, which executed it on our server as the server
   * user; that endpoint is gone. Because the worker can be terminated, Python
   * gets the hard timeout the JavaScript path above still can't offer.
   * See `lib/pythonRunner.ts`.
   *
   * The restore of `console.log` is intentionally outside the try/catch's
   * failure path — it runs whether or not the snippet threw, so a throwing
   * snippet can't leave the app's console permanently hijacked.
   */
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
      // First run downloads the interpreter (~6MB, then cached by the browser),
      // which is long enough that a silent spinner reads as a hang.
      if (!isPythonWarm()) addToast('Starting Python — first run downloads the runtime', 'info');
      setOutput(await runPython(activeCode));
    }
    setRunning(false);
  }, [activeCode, language]);

  /**
   * Insert an AI suggestion into the editor.
   *
   * Goes through the editor's imperative handle rather than setting state, so
   * Monaco applies it as a real edit: undoable with Ctrl+Z, and scoped to the
   * selection when there is one (replace just the highlighted block) instead of
   * always clobbering the whole file. Falls back to a state write only if the
   * editor hasn't mounted.
   *
   * No explicit emit needed — Monaco's change event fires `handleCodeChange`,
   * which broadcasts it like any other edit.
   */
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

  /** Roll the active file back to a checkpoint. Explicitly emits, because this
   *  writes state directly rather than going through the editor — a restore is
   *  a room-wide action, so everyone should see the rollback. */
  function handleRestoreSnapshot(content: string) {
    const fileId = fs.activeFileId;
    setFs(prev => ({
      ...prev,
      files: prev.files.map(f => f.id === fileId ? { ...f, content, unsaved: true } : f),
    }));
    socketRef.current?.emit('code_change', { room_id: roomId, file_id: fileId, content });
    addToast('Snapshot restored', 'success');
  }

  /** Drag-to-resize the output panel. Listeners go on `window`, not the handle,
   *  so the drag survives the pointer moving faster than React re-renders and
   *  leaving the 4px grab strip. Both are removed on mouseup. */
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
          onUploadFile={handleUploadFile}
          onToast={addToast}
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
