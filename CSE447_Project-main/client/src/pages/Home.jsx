import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="page-narrow">
      <h1>Report misconduct, anonymously</h1>
      <p>
        This intake tool lets you submit a report without creating an account. You'll receive a
        one-time tracking ID to check on its status later — nothing else is required, and nothing
        identifying is asked of you unless you choose to add it.
      </p>
      <div className="row" style={{ marginTop: "var(--space-6)" }}>
        <Link to="/submit" className="btn btn-primary">
          Submit a report
        </Link>
        <Link to="/track" className="btn btn-secondary">
          Track a report
        </Link>
      </div>
    </div>
  );
}
