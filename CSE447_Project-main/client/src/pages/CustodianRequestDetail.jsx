import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/axios.js";
import { getErrorMessage, routeOnAuthError } from "../api/errors.js";
import { SkeletonCard } from "../components/Skeleton.jsx";
import Banner from "../components/Banner.jsx";
import RevealRequestActions from "../components/RevealRequestActions.jsx";

export default function CustodianRequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [request, setRequest] = useState(undefined); // undefined = loading, null = not found
  const [error, setError] = useState(null);
  const [resolved, setResolved] = useState(null);

  const load = useCallback(() => {
    setRequest(undefined);
    api
      .get("/custodian/requests")
      .then((response) => {
        const found = response.data.requests.find((r) => r.id === id);
        setRequest(found || null);
      })
      .catch((err) => {
        if (routeOnAuthError(err, navigate)) return;
        setError(getErrorMessage(err));
      });
  }, [id, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="page-header">
        <h1>Reveal request</h1>
      </div>

      <p>
        <Link to="/custodian">Back to queue</Link>
      </p>

      {error && <Banner type="danger">{error}</Banner>}

      {request === undefined && !error && <SkeletonCard />}

      {request === null && !error && (
        <p className="empty-state">
          This request is no longer pending — it may have already been resolved.
        </p>
      )}

      {resolved && (
        <Banner type="info" title="Decision recorded">
          Status: {resolved.status} ({resolved.approvalsCount} / {resolved.threshold} approvals)
        </Banner>
      )}

      {request && (
        <div className="card">
          <div className="field">
            <label>Report</label>
            <p className="mono">{request.report}</p>
          </div>
          <div className="field">
            <label>Requested by</label>
            <p>{request.requestedBy ? `${request.requestedBy.username} (${request.requestedBy.role})` : "—"}</p>
          </div>
          <div className="field">
            <label>Reason</label>
            <p>{request.reason}</p>
          </div>
          <div className="field">
            <label>Approvals</label>
            <p>
              {request.approvalsCount} of {request.threshold} required
            </p>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Created</label>
            <p className="mono">{new Date(request.createdAt).toLocaleString()}</p>
          </div>
        </div>
      )}

      {request && !resolved && (
        <div style={{ marginTop: "var(--space-5)" }}>
          <RevealRequestActions
            request={request}
            onDecided={(result) => {
              setResolved(result);
              load();
            }}
          />
        </div>
      )}
    </div>
  );
}
