import React from 'react';
import './FileExplorer.css';

interface Props {
  language: string;
  roomId: string;
}

const LANG_EXT: Record<string, string> = {
  javascript: 'js', typescript: 'ts', python: 'py',
  java: 'java', cpp: 'cpp', html: 'html', css: 'css', go: 'go', rust: 'rs',
};

export default function FileExplorer({ language, roomId }: Props) {
  const ext = LANG_EXT[language] || 'txt';
  return (
    <div className="fe">
      <div className="fe-header">
        <span>Explorer</span>
      </div>
      <div className="fe-section-label">Room {roomId.slice(0, 6)}</div>
      <div className="fe-file active">
        <span className="fe-file-dot" />
        <span className="fe-file-name">main.{ext}</span>
      </div>
      <div className="fe-empty">
        <div className="fe-empty-icon">📁</div>
        <div className="fe-empty-text">No other files yet</div>
        <div className="fe-empty-sub">Files you create will appear here</div>
      </div>
    </div>
  );
}
