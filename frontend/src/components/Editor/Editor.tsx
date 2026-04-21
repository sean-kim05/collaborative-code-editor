import React, { useRef, useEffect, useCallback } from 'react';
import MonacoEditor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { RemoteCursor } from '../../types';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCursorChange: (position: { lineNumber: number; column: number }) => void;
  remoteCursors: RemoteCursor[];
  language: string;
  fontSize: number;
  theme: 'dark' | 'light';
}

export default function Editor({
  value, onChange, onCursorChange, remoteCursors, language, fontSize, theme
}: Props) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const suppressRef = useRef(false);
  const monacoRef = useRef<typeof Monaco | null>(null);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.onDidChangeCursorPosition((e) => {
      onCursorChange({ lineNumber: e.position.lineNumber, column: e.position.column });
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
  }, [theme, onCursorChange]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    monaco.editor.setTheme(theme === 'dark' ? 'collab-dark' : 'collab-light');
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

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

    const newDecorations = remoteCursors.map((cursor) => ({
      range: new monaco.Range(
        cursor.position.lineNumber,
        cursor.position.column,
        cursor.position.lineNumber,
        cursor.position.column
      ),
      options: {
        className: `remote-cursor`,
        beforeContentClassName: `remote-cursor-before`,
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        zIndex: 10,
        before: {
          content: '|',
          inlineClassName: `remote-cursor-caret`,
        },
        after: {
          content: cursor.username,
          inlineClassName: `remote-cursor-label`,
        },
      },
    }));

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
  }, [remoteCursors]);

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
}
