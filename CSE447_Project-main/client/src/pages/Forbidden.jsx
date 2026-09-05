import { Link } from "react-router-dom";

export default function Forbidden() {
  return (
    <div className="page-narrow">
      <h1>You don't have access to this</h1>
      <p>You don't have permission to view this page.</p>
      <Link to="/" className="btn btn-primary">
        Go home
      </Link>
    </div>
  );
}
