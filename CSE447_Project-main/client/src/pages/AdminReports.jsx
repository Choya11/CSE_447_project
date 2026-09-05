import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios.js";
import { getErrorMessage, routeOnAuthError } from "../api/errors.js";
import { SkeletonTable } from "../components/Skeleton.jsx";
import StatusPill from "../components/StatusPill.jsx";
import Banner from "../components/Banner.jsx";
import { ToastHost, useToast } from "../components/Toast.jsx";

export default function AdminReports() {
  const navigate = useNavigate();
  const [reports, setReports] = useState(null);
  const [reviewers, setReviewers] = useState([]);
  const [error, setError] = useState(null);
  const [assigning, setAssigning] = useState(null); // report id currently being assigned
  const [toast, showToast] = useToast();

  const load = useCallback(() => {
    Promise.all([api.get("/admin/reports"), api.get("/admin/staff?role=reviewer")])
      .then(([reportsRes, staffRes]) => {
        setReports(reportsRes.data.reports);
        setReviewers(staffRes.data.users.filter((u) => u.status === "active"));
      })
      .catch((err) => {
        if (routeOnAuthError(err, navigate)) return;
        setError(getErrorMessage(err));
      });
  }, [navigate]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAssign(reportId, reviewerId) {
    if (!reviewerId) return;
    setAssigning(reportId);
    try {
      await api.patch(`/admin/reports/${reportId}/assign`, { reviewerId });
      showToast("Report assigned");
      load();
    } catch (err) {
      if (routeOnAuthError(err, navigate)) return;
      setError(getErrorMessage(err));
    } finally {
      setAssigning(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Reports</h1>
      </div>
      <p className="text-secondary">
        Metadata only — assign unassigned reports to an active reviewer.
      </p>

      {error && <Banner type="danger">{error}</Banner>}

      {reports === null && !error && <SkeletonTable rows={5} />}

      {reports && reports.length === 0 && <p className="empty-state">No reports yet.</p>}

      {reports && reports.length > 0 && (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Report ID</th>
                <th>Status</th>
                <th>Assigned reviewer</th>
                <th>Created</th>
                <th>Assign</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td>{r.assignedReviewer ? r.assignedReviewer.username : "Unassigned"}</td>
                  <td className="mono">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td>
                    <select
                      className="input"
                      style={{ maxWidth: 200 }}
                      value=""
                      disabled={assigning === r.id}
                      onChange={(e) => handleAssign(r.id, e.target.value)}
                    >
                      <option value="">
                        {r.assignedReviewer ? "Reassign to…" : "Assign to…"}
                      </option>
                      {reviewers.map((rev) => (
                        <option key={rev.id} value={rev.id}>
                          {rev.username}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="record-cards">
            {reports.map((r) => (
              <div key={r.id} className="record-card">
                <div className="record-card-title mono">{r.id}</div>
                <div className="record-card-row">
                  <span className="rc-label">Status</span>
                  <StatusPill status={r.status} />
                </div>
                <div className="record-card-row">
                  <span className="rc-label">Assigned</span>
                  <span>{r.assignedReviewer ? r.assignedReviewer.username : "Unassigned"}</span>
                </div>
                <div className="record-card-row">
                  <span className="rc-label">Created</span>
                  <span className="mono">{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                <div style={{ marginTop: "var(--space-3)" }}>
                  <select
                    className="input"
                    value=""
                    disabled={assigning === r.id}
                    onChange={(e) => handleAssign(r.id, e.target.value)}
                  >
                    <option value="">{r.assignedReviewer ? "Reassign to…" : "Assign to…"}</option>
                    {reviewers.map((rev) => (
                      <option key={rev.id} value={rev.id}>
                        {rev.username}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <ToastHost message={toast} />
    </div>
  );
}
