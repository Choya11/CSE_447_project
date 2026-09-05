import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import api from "../api/axios.js";

const NAV = {
  reviewer: {
    brand: "Integrity Intake",
    links: [{ to: "/reviewer", label: "Dashboard", end: true }],
    tabs: [{ to: "/reviewer", label: "Dashboard", end: true }],
  },
  admin: {
    brand: "Integrity Intake — Admin",
    links: [
      { to: "/admin", label: "Dashboard", end: true },
      { to: "/admin/reviewers", label: "Reviewers" },
      { to: "/admin/custodians", label: "Custodians" },
      { to: "/admin/reports", label: "Reports" },
      { to: "/admin/audit-log", label: "Audit Log" },
    ],
    tabs: [
      { to: "/admin", label: "Dashboard", end: true },
      { to: "/admin/reports", label: "Reports" },
    ],
  },
  custodian: {
    brand: "Integrity Intake — Custodian",
    links: [{ to: "/custodian", label: "Requests", end: true }],
    tabs: [],
  },
};

export default function AuthenticatedLayout({ role }) {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const config = NAV[role];

  async function handleLogout() {
    try {
      await api.post("/auth/logout");
    } catch {
      // Even if the request fails, clear local state so the UI reflects "logged out".
    }
    setUser(null);
    navigate("/");
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="app-sidebar">
        <span className="brand">{config.brand}</span>
        <nav aria-label="Primary">
          {config.links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => (isActive ? "active" : undefined)}
            >
              {link.label}
            </NavLink>
          ))}
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
        </nav>
        <div className="sidebar-footer">Signed in as staff</div>
      </aside>

      <main className="app-main" id="main-content">
        <Outlet />
      </main>

      <nav className="bottom-tabs" aria-label="Primary">
        {config.tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            {tab.label}
          </NavLink>
        ))}
        <button type="button" onClick={handleLogout}>
          Log out
        </button>
      </nav>
    </div>
  );
}
