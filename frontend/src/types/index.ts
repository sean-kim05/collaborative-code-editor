export interface User {
  session_id: string;
  username: string;
  color: string;
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

export interface ChatMessage {
  id: string;
  room_id: string;
  username: string;
  color: string;
  message: string;
  timestamp: string;
  isSelf?: boolean;
}

export interface RoomState {
  roomId: string;
  username: string;
  color: string;
  users: User[];
  language: string;
  fontSize: number;
}
