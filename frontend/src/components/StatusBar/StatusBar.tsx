
import './StatusBar.css';

interface Props {
  language: string;
  connected: boolean;
  line?: number;
  column?: number;
}

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
