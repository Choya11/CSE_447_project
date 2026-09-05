import { Link, Outlet } from "react-router-dom";

export default function PublicLayout() {
  return (
    <div>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="public-topbar">
        <Link to="/" className="brand">
          Integrity Intake
        </Link>
        <nav aria-label="Primary">
          <Link to="/submit">Submit a report</Link>
          <Link to="/track">Track a report</Link>
        </nav>
      </header>
      <main className="public-main" id="main-content">
        <Outlet />
      </main>
      <footer className="public-footer">
        <Link to="/login">Staff login</Link>
      </footer>
    </div>
  );
}
