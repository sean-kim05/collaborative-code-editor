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

export interface RoomState {
  roomId: string;
  username: string;
  color: string;
  users: User[];
  language: string;
  fontSize: number;
}
