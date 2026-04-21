import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, Info, AlertTriangle, XCircle, X } from 'lucide-react';
import './Toast.css';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

const ICONS = {
  success: <CheckCircle size={14} />,
  info: <Info size={14} />,
  warning: <AlertTriangle size={14} />,
  error: <XCircle size={14} />,
};

export function ToastContainer({ toasts, onDismiss }: ToastProps) {
  return (
    <div className="toast-container">
      {toasts.slice(-3).map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`toast toast-${toast.type} ${visible ? 'toast-visible' : ''}`}>
      <span className="toast-icon">{ICONS[toast.type]}</span>
      <span className="toast-message">{toast.message}</span>
      <button className="toast-close" onClick={() => { setVisible(false); setTimeout(() => onDismiss(toast.id), 300); }}><X size={12} /></button>
    </div>
  );
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, dismiss };
}
