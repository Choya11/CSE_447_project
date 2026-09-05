import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios.js";
import { getErrorMessage, routeOnAuthError } from "../api/errors.js";
import Banner from "../components/Banner.jsx";

function StatCardSkeleton() {
  return (
    <div className="stat-card skeleton" style={{ height: 84 }} aria-hidden="true" />
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get("/admin/dashboard")
      .then((response) => setData(response.data))
      .catch((err) => {
        if (routeOnAuthError(err, navigate)) return;
        setError(getErrorMessage(err));
      });
  }, [navigate]);

  return (
    <div>
      <div className="page-header">
        <h1>Admin dashboard</h1>
      </div>

      {error && <Banner type="danger">{error}</Banner>}

      {!data && !error && (
        <div className="stat-grid">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      )}

      {data && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-value">{data.reviewerCount}</div>
              <div className="stat-label">Reviewers</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{data.custodianCount}</div>
              <div className="stat-label">Custodians</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{data.openReports}</div>
              <div className="stat-label">Open reports</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{data.totalReports}</div>
              <div className="stat-label">Total reports</div>
            </div>
          </div>

          <h2>Recent activity</h2>
          {data.recentLogs.length === 0 ? (
            <p className="empty-state">No recent activity.</p>
          ) : (
            <div className="stack gap-2">
              {data.recentLogs.map((log) => (
                <div key={log._id} className="card">
                  <div className="row-between">
                    <strong>{log.action}</strong>
                    <span className="mono text-muted">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-secondary" style={{ marginTop: "var(--space-1)" }}>
                    By {log.performedBy}
                    {log.targetId ? ` · target ${log.targetId}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
