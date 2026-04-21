import { useState, useRef, useEffect, useCallback } from 'react';
import './AIAssistant.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

type Mode = 'explain' | 'fix' | 'improve' | 'generate';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  isStreaming?: boolean;
  isError?: boolean;
  code?: string;
}

interface Props {
  code: string;
  selection: string;
  language: string;
  onApply: (code: string) => void;
  onClose: () => void;
}

const MODES: { key: Mode; label: string; icon: string; hint: string }[] = [
  { key: 'explain', label: 'Explain', icon: '💡', hint: 'Explains selected code or the whole file' },
  { key: 'fix',     label: 'Fix Bug',  icon: '🔧', hint: 'Paste an error and get a fix' },
  { key: 'improve', label: 'Improve',  icon: '✨', hint: 'Refactors for clarity and performance' },
  { key: 'generate',label: 'Generate', icon: '⚡', hint: 'Describe what to write, AI generates it' },
];

function extractCodeBlocks(text: string): { display: string; code: string | null } {
  const match = text.match(/```[\w]*\n?([\s\S]*?)```/);
  if (match) {
    return { display: text, code: match[1].trim() };
  }
  return { display: text, code: null };
}

export default function AIAssistant({ code, selection, language, onApply, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('explain');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [errorInput, setErrorInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const historyRef = useRef<{ role: string; content: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const sendRequest = useCallback(async (overrideInput?: string) => {
    if (isStreaming) return;

    const userPrompt = overrideInput ?? input;
    if (mode === 'generate' && !userPrompt.trim()) return;

    setIsStreaming(true);
    setInput('');

    const userLabel = mode === 'generate' ? userPrompt
      : mode === 'fix' ? `Fix bug${errorInput ? `: ${errorInput}` : ''}`
      : mode === 'explain' ? `Explain ${selection ? 'selection' : 'code'}`
      : `Improve ${selection ? 'selection' : 'code'}`;

    const newUserMsg: Message = { role: 'user', content: userLabel };
    setMessages(prev => [...prev, newUserMsg, { role: 'assistant', content: '', isStreaming: true }]);

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${SOCKET_URL}/api/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          mode,
          code,
          selection: selection || '',
          language,
          error: errorInput,
          prompt: userPrompt,
          history: historyRef.current,
        }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'text') {
              fullText += data.text;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: fullText, isStreaming: true };
                return next;
              });
            } else if (data.type === 'done') {
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: fullText, isStreaming: false };
                return next;
              });
              historyRef.current = [
                ...historyRef.current,
                { role: 'user', content: userLabel },
                { role: 'assistant', content: fullText },
              ];
            } else if (data.type === 'error') {
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: data.message, isStreaming: false, isError: true };
                return next;
              });
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: 'Connection error. Is the backend running?', isStreaming: false, isError: true };
          return next;
        });
      }
    } finally {
      setIsStreaming(false);
    }
  }, [mode, code, selection, language, errorInput, input, isStreaming]);

  function clearChat() {
    setMessages([]);
    historyRef.current = [];
  }

  return (
    <div className="ai-panel">
      <div className="ai-header">
        <div className="ai-header-left">
          <span className="ai-sparkle">✦</span>
          <span className="ai-title">AI Assistant</span>
        </div>
        <div className="ai-header-right">
          {messages.length > 0 && (
            <button className="ai-icon-btn" onClick={clearChat} title="Clear chat">⊘</button>
          )}
          <button className="ai-icon-btn" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      <div className="ai-modes">
        {MODES.map(m => (
          <button
            key={m.key}
            className={`ai-mode-btn ${mode === m.key ? 'active' : ''}`}
            onClick={() => setMode(m.key)}
            title={m.hint}
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      <div className="ai-context-bar">
        {selection ? (
          <span className="ai-context-badge selection">⬚ {selection.split('\n').length} lines selected</span>
        ) : (
          <span className="ai-context-badge">📄 Full file · {language}</span>
        )}
      </div>

      <div className="ai-chat" ref={chatRef}>
        {messages.length === 0 && (
          <div className="ai-empty">
            <div className="ai-empty-icon">✦</div>
            <p>Select code in the editor and ask me to explain, fix, or improve it.</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const { display, code: extractedCode } = msg.role === 'assistant' ? extractCodeBlocks(msg.content) : { display: msg.content, code: null };
          return (
            <div key={i} className={`ai-msg ai-msg-${msg.role} ${msg.isError ? 'error' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="ai-msg-label">✦ Claude</div>
              )}
              <div className="ai-msg-body">
                {msg.isStreaming && !msg.content ? (
                  <div className="ai-typing"><span/><span/><span/></div>
                ) : (
                  <pre className="ai-msg-text">{display}{msg.isStreaming && <span className="ai-cursor">▋</span>}</pre>
                )}
              </div>
              {extractedCode && !msg.isStreaming && (
                <button className="ai-apply-btn" onClick={() => onApply(extractedCode)}>
                  ↳ Apply to editor
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="ai-input-area">
        {mode === 'fix' && (
          <input
            className="ai-error-input"
            value={errorInput}
            onChange={e => setErrorInput(e.target.value)}
            placeholder="Paste error message (optional)…"
          />
        )}
        {mode === 'generate' ? (
          <div className="ai-input-row">
            <input
              className="ai-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendRequest()}
              placeholder="Describe the code to generate…"
              disabled={isStreaming}
            />
            <button className="ai-send-btn" onClick={() => sendRequest()} disabled={isStreaming || !input.trim()}>
              {isStreaming ? <span className="run-spinner"/> : '↑'}
            </button>
          </div>
        ) : (
          <button
            className="ai-action-btn"
            onClick={() => sendRequest()}
            disabled={isStreaming}
          >
            {isStreaming
              ? <><span className="run-spinner"/> Running…</>
              : <>{MODES.find(m => m.key === mode)?.icon} {MODES.find(m => m.key === mode)?.label} {selection ? 'selection' : 'code'}</>
            }
          </button>
        )}
      </div>
    </div>
  );
}
