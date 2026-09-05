import { useNavigate } from "react-router-dom";

export default function SessionExpired() {
  const navigate = useNavigate();
  return (
    <div className="page-narrow">
      <h1>Your session expired</h1>
      <p>Please log in again to continue.</p>
      <button type="button" className="btn btn-primary" onClick={() => navigate("/login")}>
        Log in again
      </button>
    </div>
  );
}
