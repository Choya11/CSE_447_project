import { Link, useLocation, useNavigate } from "react-router-dom";
import CopyButton from "../components/CopyButton.jsx";
import { ToastHost, useToast } from "../components/Toast.jsx";

export default function SubmitConfirmation() {
  const location = useLocation();
  const navigate = useNavigate();
  const trackingId = location.state?.trackingId;
  const [toast, showToast] = useToast();

  if (!trackingId) {
    return (
      <div className="page-narrow">
        <h1>Nothing to show here</h1>
        <p>
          There's no tracking ID to display — this page only works right after submitting a
          report. If you already submitted a report, you'll need your saved tracking ID to check
          its status.
        </p>
        <Link to="/submit" className="btn btn-primary">
          Go to submit a report
        </Link>
      </div>
    );
  }

  return (
    <div className="page-narrow">
      <h1>Report submitted</h1>
      <div className="banner banner-warning" role="alert">
        <div>
          <strong>Save this tracking ID now</strong>
          It will not be shown again. Anyone with this ID can check your report's status, so keep
          it private.
        </div>
      </div>

      <div className="card" style={{ textAlign: "center", marginBottom: "var(--space-5)" }}>
        <div
          className="mono"
          style={{ fontSize: "var(--font-size-6)", fontWeight: 600, wordBreak: "break-all" }}
        >
          {trackingId}
        </div>
        <div style={{ marginTop: "var(--space-5)" }}>
          <CopyButton
            value={trackingId}
            label="Copy tracking ID"
            onCopied={() => showToast("Copied to clipboard")}
          />
        </div>
      </div>

      <button type="button" className="btn btn-secondary btn-block" onClick={() => navigate("/track")}>
        I've saved it, go to Track page
      </button>

      <ToastHost message={toast} />
    </div>
  );
}
