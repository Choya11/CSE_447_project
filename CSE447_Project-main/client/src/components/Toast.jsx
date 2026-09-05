import { useEffect, useState, useCallback } from "react";

// Lightweight, per-page toast for low-stakes confirmations (e.g. "Copied to clipboard").
// Not for security-relevant messages — those use <Banner> and never auto-dismiss.
export function useToast() {
  const [message, setMessage] = useState(null);

  const showToast = useCallback((msg) => {
    setMessage(msg);
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(null), 2200);
    return () => clearTimeout(timer);
  }, [message]);

  return [message, showToast];
}

export function ToastHost({ message }) {
  if (!message) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite">
      <div className="toast">{message}</div>
    </div>
  );
}
