// Persistent banner for security-relevant / blocking errors. Never auto-dismisses.
export default function Banner({ type = "danger", title, children, actions }) {
  return (
    <div className={`banner banner-${type}`} role="alert">
      <div>
        {title && <strong>{title}</strong>}
        {children}
        {actions && <div className="banner-actions">{actions}</div>}
      </div>
    </div>
  );
}
