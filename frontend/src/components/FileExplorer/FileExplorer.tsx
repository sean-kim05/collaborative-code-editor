import React from 'react';
import './FileExplorer.css';

interface Props {
  language: string;
  roomId: string;
}

const LANG_EXTENSIONS: Record<string, string> = {
  javascript: 'js', typescript: 'ts', python: 'py',
  java: 'java', cpp: 'cpp', html: 'html', css: 'css', go: 'go', rust: 'rs',
};

export default function FileExplorer({ language, roomId }: Props) {
  const ext = LANG_EXTENSIONS[language] || 'txt';
  const filename = `main.${ext}`;

  return (
    <div className="file-explorer">
      <div className="fe-header">Explorer</div>
      <div className="fe-section">
        <div className="fe-section-label">Room {roomId.slice(0, 6)}</div>
        <div className="fe-file active">
          <span className="fe-file-icon">📄</span>
          <span className="fe-file-name">{filename}</span>
        </div>
      </div>
    </div>
  );
}
