/**
 * Generic Socket.IO hook — connection lifecycle plus thin emit/on/off wrappers.
 *
 * NOT CURRENTLY USED. Room.tsx manages its own socket directly, because the
 * room needs its handlers bound in the same effect that owns the connection
 * (the join handshake, the load-timeout watchdog, and ~10 event handlers that
 * must be registered exactly once). Routing that through a generic hook added
 * indirection without removing any of the ordering constraints.
 *
 * Kept as the extraction point if a second component ever needs a socket.
 * Note the default port here is 5000, while the rest of the app uses 5001 —
 * that would need fixing before this is wired up.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    return () => { socket.disconnect(); };
  }, []);

  const emit = useCallback((event: string, data: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  const on = useCallback((event: string, handler: (...args: unknown[]) => void) => {
    socketRef.current?.on(event, handler);
    return () => { socketRef.current?.off(event, handler); };
  }, []);

  const off = useCallback((event: string, handler?: (...args: unknown[]) => void) => {
    socketRef.current?.off(event, handler);
  }, []);

  return { socket: socketRef.current, connected, emit, on, off };
}
