import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/axios.js";
import { getErrorMessage } from "../api/errors.js";
import { SkeletonTable } from "../components/Skeleton.jsx";
import Banner from "../components/Banner.jsx";

const LABELS = {
  status_change: (entry) => `Status changed to ${entry.status}`,
  assigned: () => "Assigned to a reviewer",
  identity_reveal_requested: () => "Identity reveal requested",
  identity_reveal_approved: () => "Identity reveal approved",
  identity_reveal_denied: () => "Identity reveal denied",
};

export default function ReviewerReportHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get(`/reports/${id}/history`)
      .then((response) => setData(response.data))
      .catch((err) => {
        const status = err?.response?.status;
        if (status === 401) {
          navigate("/session-expired");
        } else if (status === 403) {
          navigate("/403");
        } else {
          setError(getErrorMessage(err));
        }
      });
  }, [id, navigate]);

  return (
    <div>
      <div className="page-header">
        <h1>Status history</h1>
      </div>

      <p>
        <Link to={`/reviewer/reports/${id}`}>Back to report</Link>
      </p>

      {error && <Banner type="danger">{error}</Banner>}

      {!data && !error && <SkeletonTable rows={4} />}

      {data && (
        <>
          {data.chainVerified ? (
            <Banner type="info" title="Chain verified">
              This report's history chain is intact.
            </Banner>
          ) : (
            <Banner type="danger" title="Chain verification FAILED">
              This report's history chain could not be verified. This is a security-relevant
              issue — contact an administrator.
            </Banner>
          )}

          {data.entries.length === 0 ? (
            <p className="empty-state">No history entries yet.</p>
          ) : (
            <div className="stack gap-3">
              {data.entries.map((entry, idx) => (
                <div key={idx} className="card">
                  <div className="row-between">
                    <strong>{(LABELS[entry.type] || (() => entry.type))(entry)}</strong>
                    <span className="mono text-muted">
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                  </div>
                  {entry.changedBy && (
                    <div className="text-secondary" style={{ marginTop: "var(--space-1)" }}>
                      By: {entry.changedBy}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
