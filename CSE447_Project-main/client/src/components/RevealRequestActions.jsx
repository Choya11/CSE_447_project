import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios.js";
import { getErrorMessage, routeOnAuthError } from "../api/errors.js";
import ConfirmModal from "./ConfirmModal.jsx";
import Banner from "./Banner.jsx";

// Approve/deny for a custodian reveal request. Per the design brief, a decision
// is consequential and irreversible-feeling — it always goes through an explicit
// confirm step, never fires on a single click.
export default function RevealRequestActions({ request, onDecided }) {
  const navigate = useNavigate();
  const [pendingDecision, setPendingDecision] = useState(null); // 'approve' | 'deny'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await api.post(`/custodian/requests/${request.id}/decision`, {
        decision: pendingDecision,
      });
      setPendingDecision(null);
      onDecided(response.data);
    } catch (err) {
      if (routeOnAuthError(err, navigate)) return;
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (request.alreadyVoted) {
    return <p className="text-muted">You've already recorded a decision on this request.</p>;
  }

  return (
    <div>
      {error && <Banner type="danger">{error}</Banner>}
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => setPendingDecision("approve")}>
          Approve
        </button>
        <button
          type="button"
          className="btn btn-destructive"
          onClick={() => setPendingDecision("deny")}
        >
          Deny
        </button>
      </div>

      {pendingDecision && (
        <ConfirmModal
          title={pendingDecision === "approve" ? "Approve identity reveal" : "Deny identity reveal"}
          message="This will permanently record your decision. It cannot be changed afterward."
          confirmLabel={pendingDecision === "approve" ? "Approve" : "Deny"}
          destructive={pendingDecision === "deny"}
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={() => setPendingDecision(null)}
        />
      )}
    </div>
  );
}
