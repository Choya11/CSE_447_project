export function ButtonSpinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export default function PageSpinner({ label = "Loading…" }) {
  return (
    <div className="spinner-page" role="status" aria-live="polite">
      <span className="spinner spinner-dark" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
