import { useState, useEffect } from 'react';
import type { Snapshot, SnapshotDetail } from '../../types';
import './VersionHistory.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

interface Props {
  roomId: string;
  currentCode: string;
  currentFileName: string;
  currentFileId: string;
  onRestore: (content: string) => void;
  onClose: () => void;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function diffLines(a: string, b: string) {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const result: { type: 'same' | 'add' | 'remove'; text: string }[] = [];
  const maxLen = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= aLines.length) result.push({ type: 'add', text: bLines[i] });
    else if (i >= bLines.length) result.push({ type: 'remove', text: aLines[i] });
    else if (aLines[i] === bLines[i]) result.push({ type: 'same', text: aLines[i] });
    else { result.push({ type: 'remove', text: aLines[i] }); result.push({ type: 'add', text: bLines[i] }); }
  }
  return result;
}

export default function VersionHistory({ roomId, currentCode, currentFileName, currentFileId, onRestore, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<SnapshotDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [labelInput, setLabelInput] = useState('');

  useEffect(() => {
    fetchSnapshots();
  }, [roomId]);

  async function fetchSnapshots() {
    setLoading(true);
    try {
      const res = await fetch(`${SOCKET_URL}/api/snapshots/${roomId}`);
      const data = await res.json();
      setSnapshots(data);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function saveManual() {
    setSaving(true);
    await fetch(`${SOCKET_URL}/api/snapshots/${roomId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_id: currentFileId,
        file_name: currentFileName,
        content: currentCode,
        label: labelInput || null,
      }),
    });
    setLabelInput('');
    await fetchSnapshots();
    setSaving(false);
  }

  async function selectSnapshot(s: Snapshot) {
    const res = await fetch(`${SOCKET_URL}/api/snapshots/detail/${s.id}`);
    const detail = await res.json();
    setSelected(detail);
  }

  const diff = selected ? diffLines(selected.content, currentCode) : [];
  const fileSnapshots = snapshots.filter(s => !currentFileId || s.file_id === currentFileId || s.file_name === currentFileName);

  return (
    <div className="vh-panel">
      <div className="vh-header">
        <span className="vh-title">⏱ Version History</span>
        <button className="vh-close" onClick={onClose}>✕</button>
      </div>

      <div className="vh-save-row">
        <input
          className="vh-label-input"
          value={labelInput}
          onChange={e => setLabelInput(e.target.value)}
          placeholder="Checkpoint name (optional)"
          onKeyDown={e => e.key === 'Enter' && saveManual()}
        />
        <button className="vh-save-btn" onClick={saveManual} disabled={saving}>
          {saving ? '…' : '+ Save'}
        </button>
      </div>

      {selected ? (
        <div className="vh-diff-view">
          <div className="vh-diff-header">
            <button className="vh-back-btn" onClick={() => setSelected(null)}>← Back</button>
            <span className="vh-diff-label">{selected.label || formatDate(selected.created_at)} · {selected.file_name}</span>
            <button className="vh-restore-btn" onClick={() => { onRestore(selected.content); onClose(); }}>
              Restore
            </button>
          </div>
          <div className="vh-diff-body">
            {diff.map((line, i) => (
              <div key={i} className={`vh-diff-line vh-diff-${line.type}`}>
                <span className="vh-diff-prefix">
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
                </span>
                <pre className="vh-diff-text">{line.text}</pre>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="vh-list">
          {loading && <div className="vh-empty">Loading…</div>}
          {!loading && fileSnapshots.length === 0 && (
            <div className="vh-empty">No checkpoints yet.<br/>Save one above or use Ctrl+S.</div>
          )}
          {fileSnapshots.map(s => (
            <div key={s.id} className="vh-item" onClick={() => selectSnapshot(s)}>
              <div className="vh-item-label">{s.label || 'Auto checkpoint'}</div>
              <div className="vh-item-meta">{s.file_name} · {formatDate(s.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
