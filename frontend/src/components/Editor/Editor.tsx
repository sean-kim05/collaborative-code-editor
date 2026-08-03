/**
 * Editor — Monaco wrapped for collaboration.
 *
 * The core tension in this file: Monaco owns a mutable text model internally,
 * while React wants to own state declaratively. Two things bridge them:
 *
 *  1. **Echo suppression** (the `value` effect below) — remote edits have to be
 *     pushed into Monaco imperatively without that push looking like a local
 *     edit and bouncing back to the server. `suppressRef` is the guard.
 *
 *  2. **An imperative handle** — the AI panel and follow mode need to *act on*
 *     the editor (replace a selection, scroll to a line), which can't be
 *     expressed as props. `forwardRef` + `useImperativeHandle` exposes a small,
 *     explicit API instead of leaking the whole editor instance.
 *
 * Remote cursors and selections are drawn with Monaco's decoration API rather
 * than absolutely-positioned overlays, so they stay glued to the right
 * characters through scrolling, wrapping, and font-size changes for free.
 */
import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import type { RemoteCursor, RemoteSelection } from '../../types';

/** The imperative surface exposed to Room.tsx — deliberately four methods, not
 *  the raw Monaco instance, so the coupling stays visible and testable. */
export interface EditorHandle {
  applyText: (text: string) => void;
  getSelection: () => string;
  insertAtCursor: (text: string) => void;
  revealLine: (lineNumber: number) => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCursorChange: (position: { lineNumber: number; column: number }) => void;
  onSelectionChange?: (selection: string) => void;
  remoteCursors: RemoteCursor[];
  remoteSelections?: RemoteSelection[];
  language: string;
  fontSize: number;
  theme: 'dark' | 'light';
}

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { value, onChange, onCursorChange, onSelectionChange, remoteCursors, remoteSelections = [], language, fontSize, theme },
  ref
) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const suppressRef = useRef(false);
  const monacoRef = useRef<typeof Monaco | null>(null);

  useImperativeHandle(ref, () => ({
    /**
     * Apply AI output. Replaces the selection if there is one, otherwise the
     * whole file.
     *
     * `executeEdits` rather than `setValue` for the selection case: it goes on
     * Monaco's undo stack, so Ctrl+Z reverts an unwanted suggestion in one
     * keystroke. That's the difference between "AI edits" feeling safe and
     * feeling destructive.
     */
    applyText(text: string) {
      const editor = editorRef.current;
      if (!editor) return;
      const model = editor.getModel();
      if (!model) return;
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        editor.executeEdits('ai', [{ range: selection, text, forceMoveMarkers: true }]);
      } else {
        model.setValue(text);
      }
    },
    /** Currently highlighted text, or '' when the selection is collapsed. */
    getSelection() {
      const editor = editorRef.current;
      if (!editor) return '';
      const selection = editor.getSelection();
      if (!selection || selection.isEmpty()) return '';
      return editor.getModel()?.getValueInRange(selection) || '';
    },
    /** Insert at the caret without replacing anything — a zero-width range is
     *  how Monaco expresses "insert here". */
    insertAtCursor(text: string) {
      const editor = editorRef.current;
      if (!editor) return;
      const pos = editor.getPosition();
      if (!pos) return;
      editor.executeEdits('ai', [{ range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }, text, forceMoveMarkers: true }]);
    },
    /** Scroll a line into view — the mechanism behind follow mode. Centred
     *  rather than scrolled-to-edge so there's context around the cursor. */
    revealLine(lineNumber: number) {
      editorRef.current?.revealLineInCenter(lineNumber);
    },
  }));

  /**
   * Monaco is ready: stash the instance, subscribe to cursor/selection events,
   * register the themes.
   *
   * Both listeners are attached here rather than as React props because Monaco
   * exposes them as its own event emitters. They're what feed the status bar,
   * peers' cursor overlays, and the AI panel's "selection wins over file" rule.
   *
   * Themes must be defined imperatively with literal hex — Monaco renders to a
   * canvas-like layer that can't resolve the CSS custom properties the rest of
   * the app is themed with, so these values mirror index.css by hand.
   */
  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.onDidChangeCursorPosition((e) => {
      onCursorChange({ lineNumber: e.position.lineNumber, column: e.position.column });
    });

    editor.onDidChangeCursorSelection((e) => {
      const sel = e.selection;
      if (!sel.isEmpty() && onSelectionChange) {
        const text = editor.getModel()?.getValueInRange(sel) || '';
        onSelectionChange(text);
      } else if (onSelectionChange) {
        onSelectionChange('');
      }
    });

    monaco.editor.defineTheme('collab-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        // Brand palette — mirrors index.css tokens (Monaco needs literal hex, not CSS vars)
        'editor.background': '#0a0a08',
        'editor.foreground': '#ece8de',
        'editor.lineHighlightBackground': '#15150f',
        'editor.selectionBackground': '#c8f04a33',
        'editor.inactiveSelectionBackground': '#c8f04a1f',
        'editorLineNumber.foreground': '#57534a',
        'editorLineNumber.activeForeground': '#a8a294',
        'editorCursor.foreground': '#c8f04a',
        'editorIndentGuide.background1': '#26261d',
        'editorIndentGuide.activeBackground1': '#3a3a2b',
        'editorBracketMatch.background': '#2a2a1a',
        'editorBracketMatch.border': '#aacb3e',
        'scrollbarSlider.background': '#2a2a2188',
        'scrollbarSlider.hoverBackground': '#3a3a2eaa',
        'minimap.background': '#0a0a08',
      },
    });

    monaco.editor.defineTheme('collab-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#ffffff',
        'editor.lineHighlightBackground': '#f6f8fa',
      },
    });

    monaco.editor.setTheme(theme === 'dark' ? 'collab-dark' : 'collab-light');
  }, [theme, onCursorChange, onSelectionChange]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    monaco.editor.setTheme(theme === 'dark' ? 'collab-dark' : 'collab-light');
  }, [theme]);

  /**
   * Push remote content into Monaco. The most delicate code in the app.
   *
   * Three guards, each preventing a specific failure:
   *
   *  - `current !== value` — without it, this effect would rewrite the model on
   *    *every* render, including the ones caused by the user's own typing. That
   *    means a full re-tokenise and a cursor reset per keystroke.
   *
   *  - `suppressRef` — `setValue` fires Monaco's `onChange`, which would call
   *    `onChange` -> `handleCodeChange` -> emit. A remote edit would echo
   *    straight back to the sender, who'd echo it again: an infinite loop
   *    between two clients. The flag makes the handler ignore programmatic
   *    edits. It's set and cleared synchronously, which is safe because
   *    `setValue` dispatches its event synchronously too.
   *
   *  - save/restore `pos` — `setValue` collapses the caret to the top of the
   *    document. Without restoring it, anyone else typing in the file would
   *    yank your cursor to line 1.
   *
   * Known rough edge, inherent to whole-document sync: the restored position is
   * a raw line/column, so if a peer inserts lines *above* your caret it ends up
   * offset by that many lines. Character-level sync (CRDT) is what fixes this
   * properly, by transforming the position along with the edit.
   */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const current = model.getValue();
    if (current !== value) {
      suppressRef.current = true;
      const pos = editor.getPosition();
      model.setValue(value);
      if (pos) editor.setPosition(pos);
      suppressRef.current = false;
    }
  }, [value]);

  /**
   * Render peers' cursors and selections as Monaco decorations.
   *
   * `deltaDecorations(old, new)` is a diff, not an append: passing the previous
   * ids removes them in the same call that adds the new ones. Keeping those ids
   * in `decorationsRef` is what stops stale carets from piling up — drop it and
   * every moving user leaves a trail of ghosts behind them.
   *
   * `NeverGrowsWhenTypingAtEdges` stops a remote cursor sitting at your caret
   * from swallowing the characters you type into its own decoration range.
   */
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    // Remote cursors: a zero-width range at the peer's position, with the caret
    // bar and their name injected as CSS `content` on ::before/::after
    // pseudo-elements. No real DOM nodes, so nothing to position or clean up.
    const cursorDecorations = remoteCursors.map((cursor) => ({
      range: new monaco.Range(cursor.position.lineNumber, cursor.position.column, cursor.position.lineNumber, cursor.position.column),
      options: {
        className: 'remote-cursor',
        beforeContentClassName: 'remote-cursor-before',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        zIndex: 10,
        before: { content: '|', inlineClassName: 'remote-cursor-caret' },
        after: { content: cursor.username, inlineClassName: 'remote-cursor-label' },
      },
    }));

    const selectionDecorations = remoteSelections.map((sel) => ({
      range: new monaco.Range(sel.startLine, sel.startColumn, sel.endLine, sel.endColumn),
      options: {
        className: 'remote-selection',
        inlineClassName: 'remote-selection-inline',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    }));

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [...cursorDecorations, ...selectionDecorations]);
  }, [remoteCursors, remoteSelections]);

  return (
    <div className="editor-wrapper">
      <MonacoEditor
        height="100%"
        language={language}
        value={value}
        theme={theme === 'dark' ? 'collab-dark' : 'collab-light'}
        onMount={handleMount}
        // The suppress check is the other half of the echo guard above: it
        // separates edits the user made from edits we pushed in programmatically.
        onChange={(val) => {
          if (!suppressRef.current) onChange(val || '');
        }}
        options={{
          fontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontLigatures: true,
          lineNumbers: 'on',
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          renderLineHighlight: 'all',
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          smoothScrolling: true,
          padding: { top: 12, bottom: 12 },
          tabSize: 2,
          wordWrap: 'on',
          automaticLayout: true,
        }}
      />
    </div>
  );
});

export default Editor;
