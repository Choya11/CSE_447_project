const COLORS = {
  Open: "var(--status-open)",
  Investigating: "var(--status-investigating)",
  Resolved: "var(--status-resolved)",
  pending: "var(--status-pending)",
  approved: "var(--status-approved)",
  denied: "var(--status-denied)",
};

export default function StatusPill({ status }) {
  const color = COLORS[status] || "var(--text-muted)";
  return (
    <span className="status-pill">
      <span className="status-dot" style={{ background: color }} aria-hidden="true" />
      {status}
    </span>
  );
}
