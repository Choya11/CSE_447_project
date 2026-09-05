import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios.js";
import { routeOnAuthError, getErrorMessage } from "../api/errors.js";
import { SkeletonTable } from "../components/Skeleton.jsx";
import StatusPill from "../components/StatusPill.jsx";
import Banner from "../components/Banner.jsx";

export default function ReviewerDashboard() {
  const navigate = useNavigate();
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get("/reports/assigned")
      .then((response) => setReports(response.data.reports))
      .catch((err) => {
        if (routeOnAuthError(err, navigate)) return;
        setError(getErrorMessage(err));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Assigned reports</h1>
      </div>

      {error && <Banner type="danger">{error}</Banner>}

      {reports === null && !error && <SkeletonTable rows={5} />}

      {reports && reports.length === 0 && (
        <p className="empty-state">No reports currently assigned to you.</p>
      )}

      {reports && reports.length > 0 && (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr
                  key={r.id}
                  className="clickable"
                  tabIndex={0}
                  onClick={() => navigate(`/reviewer/reports/${r.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") navigate(`/reviewer/reports/${r.id}`);
                  }}
                >
                  <td>{r.title}</td>
                  <td>{r.category}</td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td className="mono">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="record-cards">
            {reports.map((r) => (
              <div
                key={r.id}
                className="record-card"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/reviewer/reports/${r.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate(`/reviewer/reports/${r.id}`);
                }}
              >
                <div className="record-card-title">{r.title}</div>
                <div className="record-card-row">
                  <span className="rc-label">Category</span>
                  <span>{r.category}</span>
                </div>
                <div className="record-card-row">
                  <span className="rc-label">Status</span>
                  <StatusPill status={r.status} />
                </div>
                <div className="record-card-row">
                  <span className="rc-label">Created</span>
                  <span className="mono">{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
