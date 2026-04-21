import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types';

interface RoomContextValue {
  roomId: string;
  setRoomId: (id: string) => void;
  username: string;
  setUsername: (name: string) => void;
  color: string;
  setColor: (color: string) => void;
  users: User[];
  setUsers: (users: User[]) => void;
  language: string;
  setLanguage: (lang: string) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomProvider({ children }: { children: ReactNode }) {
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [color, setColor] = useState('#38BDF8');
  const [users, setUsers] = useState<User[]>([]);
  const [language, setLanguage] = useState('javascript');
  const [fontSize, setFontSize] = useState(14);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  return (
    <RoomContext.Provider value={{
      roomId, setRoomId,
      username, setUsername,
      color, setColor,
      users, setUsers,
      language, setLanguage,
      fontSize, setFontSize,
      theme, setTheme,
    }}>
      {children}
    </RoomContext.Provider>
  );
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used within RoomProvider');
  return ctx;
}
