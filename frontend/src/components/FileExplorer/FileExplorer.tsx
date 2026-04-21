import React, { useState, useRef } from 'react';
import type { FileNode, User } from '../../types';
import './FileExplorer.css';

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';

  const icons: Record<string, React.ReactElement> = {
    js: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#F7DF1E"/>
        <text x="2" y="13" fontSize="9" fontWeight="bold" fontFamily="monospace" fill="#000">JS</text>
      </svg>
    ),
    jsx: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#F7DF1E"/>
        <text x="1" y="13" fontSize="8" fontWeight="bold" fontFamily="monospace" fill="#000">JSX</text>
      </svg>
    ),
    ts: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#3178C6"/>
        <text x="2" y="13" fontSize="9" fontWeight="bold" fontFamily="monospace" fill="#fff">TS</text>
      </svg>
    ),
    tsx: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#3178C6"/>
        <text x="1" y="13" fontSize="8" fontWeight="bold" fontFamily="monospace" fill="#fff">TSX</text>
      </svg>
    ),
    py: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#3776AB"/>
        <path d="M8 2.5c-2 0-1.8.9-1.8 0.9V5h3.6v.5H4.7S3 5.3 3 7.5s1.5 2.1 1.5 2.1H5.5V8.4S5.4 7 6.8 7h3.2s1.3 0 1.3-1.3V4.3S11.5 2.5 8 2.5z" fill="#FFD43B"/>
        <path d="M8 13.5c2 0 1.8-.9 1.8-.9V11H6.2v-.5h5.1S13 10.7 13 8.5s-1.5-2.1-1.5-2.1H10.5v1.2s.1 1.4-1.3 1.4H6s-1.3 0-1.3 1.3v1.4S4.5 13.5 8 13.5z" fill="#fff"/>
        <circle cx="6.5" cy="4" r=".8" fill="#fff"/>
        <circle cx="9.5" cy="12" r=".8" fill="#FFD43B"/>
      </svg>
    ),
    html: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#E44D26"/>
        <path d="M3 2l1 10 4 1.5 4-1.5 1-10H3z" fill="#F16529"/>
        <path d="M8 12.5V4H5.5l.7 7.2L8 12.5z" fill="#fff" opacity=".9"/>
        <path d="M8 4h2.5l-.7 7.2L8 12.5V4z" fill="#fff"/>
      </svg>
    ),
    css: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#1572B6"/>
        <path d="M3 2l1 10 4 1.5 4-1.5 1-10H3z" fill="#33A9DC"/>
        <path d="M8 12.5V4H5.5l.7 7.2L8 12.5z" fill="#fff" opacity=".9"/>
        <path d="M8 4h2.5l-.7 7.2L8 12.5V4z" fill="#fff"/>
      </svg>
    ),
    json: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#1e1e1e"/>
        <text x="1.5" y="12" fontSize="9" fontWeight="bold" fontFamily="monospace" fill="#FFBE00">{'{}'}</text>
      </svg>
    ),
    go: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#00ADD8"/>
        <text x="1.5" y="13" fontSize="9" fontWeight="bold" fontFamily="monospace" fill="#fff">GO</text>
      </svg>
    ),
    rs: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#CE422B"/>
        <text x="1.5" y="13" fontSize="8" fontWeight="bold" fontFamily="monospace" fill="#fff">RS</text>
      </svg>
    ),
    java: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#E76F00"/>
        <text x="1" y="13" fontSize="7.5" fontWeight="bold" fontFamily="monospace" fill="#fff">JAVA</text>
      </svg>
    ),
    cpp: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#00599C"/>
        <text x="1.5" y="13" fontSize="8" fontWeight="bold" fontFamily="monospace" fill="#fff">C++</text>
      </svg>
    ),
    c: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#00599C"/>
        <text x="4" y="13" fontSize="9" fontWeight="bold" fontFamily="monospace" fill="#fff">C</text>
      </svg>
    ),
    md: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#519aba"/>
        <text x="1.5" y="13" fontSize="8" fontWeight="bold" fontFamily="monospace" fill="#fff">MD</text>
      </svg>
    ),
    sh: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#4EAA25"/>
        <text x="1.5" y="13" fontSize="8.5" fontWeight="bold" fontFamily="monospace" fill="#fff">SH</text>
      </svg>
    ),
    sql: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect width="16" height="16" rx="2" fill="#ffca28"/>
        <text x="1" y="13" fontSize="8" fontWeight="bold" fontFamily="monospace" fill="#333">SQL</text>
      </svg>
    ),
  };

  return icons[ext] ?? (
    <svg viewBox="0 0 16 16" width="16" height="16">
      <rect width="16" height="16" rx="2" fill="#6e7681"/>
      <path d="M4 5h8M4 8h8M4 11h5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function getLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', java: 'java', cpp: 'cpp', c: 'cpp',
    html: 'html', css: 'css', json: 'json',
    go: 'go', rs: 'rust', md: 'markdown',
  };
  return map[ext] || 'plaintext';
}

interface Props {
  files: FileNode[];
  activeFileId: string;
  users: User[];
  currentSessionId?: string;
  onSwitchFile: (fileId: string) => void;
  onCreateFile: (name: string, language: string) => void;
  onDeleteFile: (fileId: string) => void;
  onRenameFile: (fileId: string, name: string) => void;
}

export default function FileExplorer({
  files, activeFileId, users, currentSessionId,
  onSwitchFile, onCreateFile, onDeleteFile, onRenameFile,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileId: string } | null>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  function startCreate() {
    setCreating(true);
    setNewName('');
    setTimeout(() => newInputRef.current?.focus(), 50);
  }

  function confirmCreate() {
    const name = newName.trim();
    if (name) onCreateFile(name, getLanguage(name));
    setCreating(false);
    setNewName('');
  }

  function startRename(file: FileNode) {
    setContextMenu(null);
    setRenamingId(file.id);
    setRenameVal(file.name);
  }

  function confirmRename() {
    if (renamingId && renameVal.trim()) onRenameFile(renamingId, renameVal.trim());
    setRenamingId(null);
  }

  function handleContext(e: React.MouseEvent, fileId: string) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, fileId });
  }

  function getUserOnFile(fileId: string) {
    return users.filter(u => u.session_id !== currentSessionId && u.activeFileId === fileId);
  }

  return (
    <div className="fe" onClick={() => setContextMenu(null)}>
      <div className="fe-header">
        <span>Explorer</span>
        <button className="fe-new-btn" onClick={startCreate} title="New file">+</button>
      </div>

      <div className="fe-files">
        {files.map(file => {
          const watchers = getUserOnFile(file.id);
          return (
            <div key={file.id}>
              {renamingId === file.id ? (
                <div className="fe-file-rename">
                  <input
                    className="fe-rename-input"
                    value={renameVal}
                    autoFocus
                    onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setRenamingId(null); }}
                    onBlur={confirmRename}
                  />
                </div>
              ) : (
                <div
                  className={`fe-file ${file.id === activeFileId ? 'active' : ''} ${file.unsaved ? 'unsaved' : ''}`}
                  onClick={() => onSwitchFile(file.id)}
                  onContextMenu={e => handleContext(e, file.id)}
                >
                  <span className="fe-file-icon"><FileIcon name={file.name} /></span>
                  <span className="fe-file-name">{file.name}</span>
                  {file.unsaved && <span className="fe-unsaved-dot" title="Unsaved changes" />}
                  {watchers.length > 0 && (
                    <div className="fe-watchers">
                      {watchers.slice(0, 3).map(u => (
                        <span key={u.session_id} className="fe-watcher-dot" style={{ background: u.color }} title={u.username} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {creating && (
          <div className="fe-file-rename">
            <input
              ref={newInputRef}
              className="fe-rename-input"
              value={newName}
              placeholder="filename.js"
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmCreate(); if (e.key === 'Escape') setCreating(false); }}
              onBlur={confirmCreate}
            />
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          className="fe-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => { startRename(files.find(f => f.id === contextMenu.fileId)!); }}>
            Rename
          </button>
          <button
            className="danger"
            onClick={() => { onDeleteFile(contextMenu.fileId); setContextMenu(null); }}
            disabled={files.length <= 1}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
