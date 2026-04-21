import React, { useState } from 'react';
import type { User } from '../../types';
import './UserPresence.css';

interface Props {
  users: User[];
  currentSessionId?: string;
}

export default function UserPresence({ users, currentSessionId }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="user-presence">
      {users.map((user) => (
        <div
          key={user.session_id}
          className="avatar"
          style={{ borderColor: user.color }}
          onMouseEnter={() => setHoveredId(user.session_id)}
          onMouseLeave={() => setHoveredId(null)}
        >
          <span className="avatar-initials" style={{ background: user.color }}>
            {user.username.slice(0, 2).toUpperCase()}
          </span>
          <span className="online-dot" />
          {hoveredId === user.session_id && (
            <div className="avatar-tooltip">
              {user.username}{user.session_id === currentSessionId ? ' (you)' : ''}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
