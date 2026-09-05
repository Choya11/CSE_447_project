import { useState } from "react";

export default function CopyButton({ value, label = "Copy", onCopied, className = "" }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for environments without clipboard API access.
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        /* no-op */
      }
      document.body.removeChild(el);
    }
    setCopied(true);
    if (onCopied) onCopied();
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" className={`copy-btn ${className}`} onClick={handleCopy}>
      {copied ? "Copied" : label}
    </button>
  );
}
