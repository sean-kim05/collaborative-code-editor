import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import type { RemoteCursor, RemoteSelection } from '../../types';

export interface EditorHandle {
  applyText: (text: string) => void;
  getSelection: () => string;
  insertAtCursor: (text: string) => void;
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
    getSelection() {
      const editor = editorRef.current;
      if (!editor) return '';
      const selection = editor.getSelection();
      if (!selection || selection.isEmpty()) return '';
      return editor.getModel()?.getValueInRange(selection) || '';
    },
    insertAtCursor(text: string) {
      const editor = editorRef.current;
      if (!editor) return;
      const pos = editor.getPosition();
      if (!pos) return;
      editor.executeEdits('ai', [{ range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }, text, forceMoveMarkers: true }]);
    },
  }));

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
        'editor.background': '#0d1117',
        'editor.lineHighlightBackground': '#161b22',
        'editorLineNumber.foreground': '#484f58',
        'editorCursor.foreground': '#58a6ff',
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

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

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
