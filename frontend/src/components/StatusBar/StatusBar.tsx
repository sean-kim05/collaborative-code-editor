
import './StatusBar.css';

interface Props {
  language: string;
  connected: boolean;
  line?: number;
  column?: number;
}

/**
 * VS Code-style footer: connection state, caret position, active language.
 *
 * The connection indicator is the important one — in a collaborative editor the
 * user needs to know at a glance whether what they're typing is reaching anyone
 * else. Purely presentational; `connected` is driven by the socket's
 * connect/disconnect events in Room.tsx.
 */
export default function StatusBar({ language, connected, line = 1, column = 1 }: Props) {
  return (
    <div className="status-bar">
      <div className="status-left">
        <div className={`status-conn ${connected ? 'connected' : 'disconnected'}`}>
          <span className="status-dot" />
          <span>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
      <div className="status-right">
        <span className="status-item">Ln {line}, Col {column}</span>
        <span className="status-item status-lang">{language}</span>
      </div>
    </div>
  );
}
