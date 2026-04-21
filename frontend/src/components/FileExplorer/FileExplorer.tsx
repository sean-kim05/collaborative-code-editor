import React, { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
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
    py: 'python', java: 'java', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'cpp',
    html: 'html', css: 'css', json: 'json',
    go: 'go', rs: 'rust', md: 'markdown', sh: 'shell', sql: 'sql',
  };
  return map[ext] || 'plaintext';
}

function getUniqueName(name: string, existingFiles: FileNode[]): string {
  const existing = new Set(existingFiles.map(f => f.name));
  if (!existing.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const ext = dot >= 0 ? name.slice(dot) : '';
  let i = 1;
  while (existing.has(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}

function looksLikeBinary(content: string): boolean {
  const sample = content.slice(0, 8000);
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0) return true;
  }
  const nonPrintable = (sample.match(/[\x01-\x08\x0E-\x1F]/g) || []).length;
  return nonPrintable / sample.length > 0.05;
}

const MAX_FILE_SIZE = 500 * 1024; // 500KB

interface Props {
  files: FileNode[];
  activeFileId: string;
  users: User[];
  currentSessionId?: string;
  onSwitchFile: (fileId: string) => void;
  onCreateFile: (name: string, language: string) => void;
  onDeleteFile: (fileId: string) => void;
  onRenameFile: (fileId: string, name: string) => void;
  onUploadFile: (name: string, language: string, content: string) => void;
  onToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

export default function FileExplorer({
  files, activeFileId, users, currentSessionId,
  onSwitchFile, onCreateFile, onDeleteFile, onRenameFile,
  onUploadFile, onToast,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNameError, setNewNameError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [renameError, setRenameError] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileId: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function startCreate() {
    setCreating(true);
    setNewName('');
    setTimeout(() => newInputRef.current?.focus(), 50);
  }

  function validateName(name: string): string {
    if (!name.trim()) return 'File name cannot be empty';
    if (/[/\\:*?"<>|]/.test(name)) return 'Invalid characters in file name';
    if (name.trim().startsWith('.') && name.trim().length === 1) return 'Invalid file name';
    return '';
  }

  function confirmCreate() {
    const name = newName.trim();
    const err = validateName(name);
    if (err) { setNewNameError(err); return; }
    onCreateFile(name, getLanguage(name));
    setCreating(false);
    setNewName('');
    setNewNameError('');
  }

  function startRename(file: FileNode) {
    setContextMenu(null);
    setRenamingId(file.id);
    setRenameVal(file.name);
    setRenameError('');
  }

  function confirmRename() {
    const name = renameVal.trim();
    const err = validateName(name);
    if (err) { setRenameError(err); return; }
    if (renamingId) onRenameFile(renamingId, name);
    setRenamingId(null);
    setRenameError('');
  }

  function handleContext(e: React.MouseEvent, fileId: string) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, fileId });
  }

  function getUserOnFile(fileId: string) {
    return users.filter(u => u.session_id !== currentSessionId && u.activeFileId === fileId);
  }

  function processFile(file: File) {
    if (file.size > MAX_FILE_SIZE) {
      onToast('File too large (max 500KB)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (looksLikeBinary(content)) {
        onToast('Only text files are supported', 'error');
        return;
      }
      const uniqueName = getUniqueName(file.name, files);
      const lang = getLanguage(uniqueName);
      onUploadFile(uniqueName, lang, content);
    };
    reader.onerror = () => onToast('Failed to read file', 'error');
    reader.readAsText(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  return (
    <div
      className={`fe ${isDragOver ? 'fe-drag-over' : ''}`}
      onClick={() => setContextMenu(null)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="fe-drop-zone">
          <Upload size={20} />
          <span>Drop to upload</span>
        </div>
      )}

      <div className="fe-header">
        <span>Explorer</span>
        <div className="fe-header-actions">
          <button
            className="fe-new-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Upload file"
          >
            <Upload size={12} />
          </button>
          <button className="fe-new-btn" onClick={startCreate} title="New file">+</button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="fe-hidden-input"
        accept=".js,.jsx,.ts,.tsx,.py,.java,.cpp,.cc,.html,.css,.go,.rs,.md,.json,.txt,.sh,.yaml,.yml,.env,.gitignore"
        onChange={handleFileInput}
      />

      <div className="fe-files">
        {files.map(file => {
          const watchers = getUserOnFile(file.id);
          return (
            <div key={file.id}>
              {renamingId === file.id ? (
                <div className="fe-file-rename">
                  <input
                    className={`fe-rename-input ${renameError ? 'fe-input-error' : ''}`}
                    value={renameVal}
                    autoFocus
                    onChange={e => { setRenameVal(e.target.value); setRenameError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') { setRenamingId(null); setRenameError(''); } }}
                    onBlur={confirmRename}
                    title={renameError || undefined}
                  />
                  {renameError && <div className="fe-input-error-msg">{renameError}</div>}
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
              className={`fe-rename-input ${newNameError ? 'fe-input-error' : ''}`}
              value={newName}
              placeholder="filename.js"
              onChange={e => { setNewName(e.target.value); setNewNameError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') confirmCreate(); if (e.key === 'Escape') { setCreating(false); setNewNameError(''); } }}
              onBlur={() => { if (!newName.trim()) { setCreating(false); setNewNameError(''); } else confirmCreate(); }}
              title={newNameError || undefined}
            />
            {newNameError && <div className="fe-input-error-msg">{newNameError}</div>}
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
