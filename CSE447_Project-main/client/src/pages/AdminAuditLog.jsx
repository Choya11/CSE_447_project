import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios.js";
import { getErrorMessage, routeOnAuthError } from "../api/errors.js";
import { SkeletonTable } from "../components/Skeleton.jsx";
import Banner from "../components/Banner.jsx";

export default function AdminAuditLog() {
  const navigate = useNavigate();
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(
    (e) => {
      if (e) e.preventDefault();
      setData(null);
      const params = {};
      if (action) params.action = action;
      if (actor) params.actor = actor;
      if (from) params.from = from;
      if (to) params.to = to;

      api
        .get("/admin/audit-logs", { params })
        .then((response) => setData(response.data))
        .catch((err) => {
          if (routeOnAuthError(err, navigate)) return;
          setError(getErrorMessage(err));
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Audit log</h1>
      </div>

      {error && <Banner type="danger">{error}</Banner>}

      {data && (
        <>
          {data.chainVerified ? (
            <Banner type="info" title="Chain verified">
              The audit log hash chain is intact.
            </Banner>
          ) : (
            <Banner type="danger" title="CHAIN VERIFICATION FAILED">
              The audit log hash chain could not be verified. This indicates possible tampering
              and should be investigated immediately.
            </Banner>
          )}
        </>
      )}

      <form onSubmit={load} className="filters-bar">
        <div className="field">
          <label htmlFor="filter-action">Action</label>
          <input id="filter-action" className="input" value={action} onChange={(e) => setAction(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="filter-actor">Actor</label>
          <input id="filter-actor" className="input" value={actor} onChange={(e) => setActor(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="filter-from">From</label>
          <input
            id="filter-from"
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="filter-to">To</label>
          <input id="filter-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-secondary">
          Apply filters
        </button>
      </form>

      {data === null && !error && <SkeletonTable rows={6} />}

      {data && data.logs.length === 0 && <p className="empty-state">No matching audit log entries.</p>}

      {data && data.logs.length > 0 && (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Performed by</th>
                <th>Target</th>
                <th>Timestamp</th>
                <th>MAC</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.map((log) => (
                <tr key={log._id}>
                  <td>{log.action}</td>
                  <td>{log.performedBy}</td>
                  <td className="mono">{log.targetId || "—"}</td>
                  <td className="mono">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="mono" style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {log.mac}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="record-cards">
            {data.logs.map((log) => (
              <div key={log._id} className="record-card">
                <div className="record-card-title">{log.action}</div>
                <div className="record-card-row">
                  <span className="rc-label">By</span>
                  <span>{log.performedBy}</span>
                </div>
                <div className="record-card-row">
                  <span className="rc-label">Target</span>
                  <span className="mono">{log.targetId || "—"}</span>
                </div>
                <div className="record-card-row">
                  <span className="rc-label">Time</span>
                  <span className="mono">{new Date(log.timestamp).toLocaleString()}</span>
                </div>
                <div className="record-card-row">
                  <span className="rc-label">MAC</span>
                  <span className="mono" style={{ wordBreak: "break-all" }}>
                    {log.mac}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
