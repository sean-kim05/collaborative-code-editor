import React, { useState, useRef } from 'react';
import type { FileNode, User } from '../../types';
import './FileExplorer.css';

const FILE_ICONS: Record<string, string> = {
  js: '🟨', ts: '🔷', tsx: '🔷', jsx: '🟨',
  py: '🐍', java: '☕', cpp: '⚙', c: '⚙',
  html: '🌐', css: '🎨', json: '📋',
  go: '🐹', rs: '🦀', md: '📝',
  txt: '📄', sh: '💲', sql: '🗄',
};

function getIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || '📄';
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
                  <span className="fe-file-icon">{getIcon(file.name)}</span>
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
