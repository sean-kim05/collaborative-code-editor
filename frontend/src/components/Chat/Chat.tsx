import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage } from '../../types';
import './Chat.css';

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  currentUsername: string;
}

export default function Chat({ messages, onSend, currentUsername }: Props) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput('');
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="chat">
      <div className="chat-header">Chat</div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">No messages yet. Say hi!</div>
        )}
        {messages.map((msg) => {
          const isSelf = msg.username === currentUsername;
          return (
            <div key={msg.id} className={`chat-message ${isSelf ? 'self' : 'other'}`}>
              {!isSelf && (
                <div className="chat-meta">
                  <span className="chat-dot" style={{ background: msg.color }} />
                  <span className="chat-username">{msg.username}</span>
                  <span className="chat-time">{formatTime(msg.timestamp)}</span>
                </div>
              )}
              <div className="chat-bubble" style={isSelf ? { background: msg.color, color: '#000' } : {}}>
                {msg.message}
              </div>
              {isSelf && (
                <div className="chat-meta right">
                  <span className="chat-time">{formatTime(msg.timestamp)}</span>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          className="chat-input"
          placeholder="Message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
        />
        <button className="chat-send" onClick={handleSend} disabled={!input.trim()}>
          ↑
        </button>
      </div>
    </div>
  );
}
