import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/axios.js";
import { getErrorMessage, routeOnAuthError } from "../api/errors.js";
import { SkeletonTable } from "../components/Skeleton.jsx";
import Banner from "../components/Banner.jsx";

export default function CustodianQueue() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api
      .get("/custodian/requests")
      .then((response) => setRequests(response.data.requests))
      .catch((err) => {
        if (routeOnAuthError(err, navigate)) return;
        setError(getErrorMessage(err));
      });
  }, [navigate]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="page-header">
        <h1>Pending identity reveal requests</h1>
      </div>

      {error && <Banner type="danger">{error}</Banner>}

      {requests === null && !error && <SkeletonTable rows={4} />}

      {requests && requests.length === 0 && <p className="empty-state">No pending requests.</p>}

      {requests && requests.length > 0 && (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Report</th>
                <th>Requested by</th>
                <th>Reason</th>
                <th>Approvals</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr
                  key={r.id}
                  className="clickable"
                  tabIndex={0}
                  onClick={() => navigate(`/custodian/requests/${r.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") navigate(`/custodian/requests/${r.id}`);
                  }}
                >
                  <td className="mono">{r.report}</td>
                  <td>{r.requestedBy ? `${r.requestedBy.username} (${r.requestedBy.role})` : "—"}</td>
                  <td>{r.reason}</td>
                  <td>
                    {r.approvalsCount} / {r.threshold}
                    {r.alreadyVoted ? " (you voted)" : ""}
                  </td>
                  <td className="mono">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="record-cards">
            {requests.map((r) => (
              <Link key={r.id} to={`/custodian/requests/${r.id}`} className="record-card" style={{ display: "block" }}>
                <div className="record-card-title mono">{r.report}</div>
                <div className="record-card-row">
                  <span className="rc-label">Requested by</span>
                  <span>{r.requestedBy ? `${r.requestedBy.username} (${r.requestedBy.role})` : "—"}</span>
                </div>
                <div className="record-card-row">
                  <span className="rc-label">Reason</span>
                  <span>{r.reason}</span>
                </div>
                <div className="record-card-row">
                  <span className="rc-label">Approvals</span>
                  <span>
                    {r.approvalsCount} / {r.threshold}
                    {r.alreadyVoted ? " (you voted)" : ""}
                  </span>
                </div>
                <div className="record-card-row">
                  <span className="rc-label">Created</span>
                  <span className="mono">{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
