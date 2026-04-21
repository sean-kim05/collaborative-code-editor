import { Code2 } from 'lucide-react';
import './LoadingScreen.css';

export default function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-logo"><Code2 size={32} strokeWidth={1.5} /></div>
      <div className="loading-text">Joining room…</div>
      <div className="loading-dots">
        <span /><span /><span />
      </div>
    </div>
  );
}
