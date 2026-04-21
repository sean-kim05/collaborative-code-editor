import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import type { User } from '../../types';
import './UserPresence.css';

const AVATAR_COLORS = [
  'var(--avatar-1)', 'var(--avatar-2)', 'var(--avatar-3)',
  'var(--avatar-4)', 'var(--avatar-5)', 'var(--avatar-6)',
];

interface Props {
  users: User[];
  currentSessionId?: string;
  followingUserId?: string | null;
  onFollow?: (sessionId: string | null) => void;
}

export default function UserPresence({ users, currentSessionId, followingUserId, onFollow }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const visible = users.slice(0, 5);
  const overflow = users.length - 5;

  return (
    <div className="user-presence">
      {visible.map((user, i) => {
        const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
        const isSelf = user.session_id === currentSessionId;
        const isFollowing = followingUserId === user.session_id;
        const isInFollowMode = !!followingUserId && !isSelf;

        return (
          <div
            key={user.session_id}
            className={`avatar ${isFollowing ? 'avatar-followed' : ''} ${isInFollowMode && !isFollowing ? 'avatar-dimmed' : ''} ${!isSelf && onFollow ? 'avatar-clickable' : ''}`}
            style={{ '--avatar-color': color, zIndex: visible.length - i } as React.CSSProperties}
            onMouseEnter={() => setHoveredId(user.session_id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => {
              if (isSelf || !onFollow) return;
              onFollow(isFollowing ? null : user.session_id);
            }}
          >
            <span className="avatar-initials">{user.username.slice(0, 1).toUpperCase()}</span>
            <span className="avatar-dot" />
            {isFollowing && (
              <span className="avatar-eye"><Eye size={9} /></span>
            )}
            {hoveredId === user.session_id && (
              <div className="avatar-tooltip">
                <div className="tooltip-name">{user.username}{isSelf ? ' (you)' : ''}</div>
                <div className="tooltip-status">
                  {isSelf ? 'Active now' : isFollowing ? 'Following — click to stop' : 'Click to follow'}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {overflow > 0 && (
        <div className="avatar avatar-overflow">
          <span className="avatar-initials">+{overflow}</span>
        </div>
      )}
    </div>
  );
}
