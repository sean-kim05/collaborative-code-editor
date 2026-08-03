/**
 * Shared types — the contract between the Flask backend and the React client.
 *
 * Note the mixed casing: `session_id`, `file_id`, `created_at` are snake_case
 * because they cross the wire from Python and are used verbatim rather than
 * being remapped, while client-only fields (`activeFileId`, `unsaved`) follow
 * JS convention. The casing tells you which side of the boundary a field
 * came from.
 */

/** A connected participant. `session_id` is the Socket.IO sid — the identity
 *  for everything real-time, and it changes on every reconnect. */
export interface User {
  session_id: string;
  username: string;
  color: string;
  activeFileId?: string;
}

export interface CursorPosition {
  lineNumber: number;
  column: number;
}

export interface RemoteCursor {
  session_id: string;
  username: string;
  color: string;
  position: CursorPosition;
}

export interface RemoteSelection {
  session_id: string;
  username: string;
  color: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  username: string;
  color: string;
  message: string;
  timestamp: string;
  isSelf?: boolean;
}

/** A file. `id` is the server-minted uuid every sync message addresses;
 *  `unsaved` is a local-only dirty flag driving the tab dot. */
export interface FileNode {
  id: string;
  name: string;
  content: string;
  language: string;
  unsaved?: boolean;
}

export interface FileSystem {
  files: FileNode[];
  activeFileId: string;
}

/** Snapshot list entry — metadata only. `SnapshotDetail` adds the body, which
 *  is fetched separately so the history list stays cheap. */
export interface Snapshot {
  id: number;
  file_id: string;
  file_name: string;
  label: string | null;
  created_at: string;
}

export interface SnapshotDetail extends Snapshot {
  content: string;
}

export interface RoomMeta {
  visibility: 'public' | 'private';
  password: string | null;
  owner: string | null;
}

export interface TypingUser {
  session_id: string;
  username: string;
  color: string;
}

/** Shape backing RoomContext. Unused while Room.tsx owns this state locally. */
export interface RoomState {
  roomId: string;
  username: string;
  color: string;
  users: User[];
  language: string;
  fontSize: number;
}
