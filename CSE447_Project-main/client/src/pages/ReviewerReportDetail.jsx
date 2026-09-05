import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/axios.js";
import { getErrorMessage } from "../api/errors.js";
import { SkeletonCard } from "../components/Skeleton.jsx";
import StatusPill from "../components/StatusPill.jsx";
import Banner from "../components/Banner.jsx";
import { ButtonSpinner } from "../components/Spinner.jsx";

const STATUS_ORDER = ["Open", "Investigating", "Resolved"];

export default function ReviewerReportDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [report, setReport] = useState(null);
  const [pageState, setPageState] = useState("loading"); // loading | ok | integrity-failed | not-found | error
  const [error, setError] = useState(null);

  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState(null);

  // Identity reveal
  const [revealState, setRevealState] = useState(null); // null (checking) | none | pending | denied | approved
  const [revealData, setRevealData] = useState(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [revealError, setRevealError] = useState(null);

  const loadReport = useCallback(() => {
    setPageState("loading");
    api
      .get(`/reports/${id}`)
      .then((response) => {
        setReport(response.data);
        setPageState("ok");
      })
      .catch((err) => {
        const status = err?.response?.status;
        if (status === 403) {
          navigate("/403");
        } else if (status === 409) {
          setPageState("integrity-failed");
        } else if (status === 404) {
          setPageState("not-found");
        } else if (status === 401) {
          navigate("/session-expired");
        } else {
          setPageState("error");
          setError(getErrorMessage(err));
        }
      });
  }, [id, navigate]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const checkReveal = useCallback(() => {
    setRevealState(null);
    api
      .get(`/reports/${id}/reveal-identity`)
      .then((response) => {
        const data = response.data;
        setRevealState(data.status);
        setRevealData(data);
      })
      .catch((err) => {
        if (err?.response?.status === 404) {
          setRevealState("none");
        } else {
          setRevealState("none");
        }
      });
  }, [id]);

  useEffect(() => {
    if (report?.hasIdentity) {
      checkReveal();
    }
  }, [report, checkReveal]);

  async function handleStatusChange(newStatus) {
    setStatusError(null);
    setStatusUpdating(true);
    try {
      const response = await api.patch(`/reports/${id}/status`, { status: newStatus });
      setReport((r) => ({ ...r, status: response.data.status }));
    } catch (err) {
      if (err?.response?.status === 401) {
        navigate("/session-expired");
        return;
      }
      if (err?.response?.status === 403) {
        navigate("/403");
        return;
      }
      setStatusError(getErrorMessage(err));
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleRequestReveal(e) {
    e.preventDefault();
    setRevealError(null);
    if (!reason.trim()) {
      setRevealError("A reason is required.");
      return;
    }
    setRequesting(true);
    try {
      await api.post(`/reports/${id}/reveal-identity`, { reason });
      setReasonOpen(false);
      setReason("");
      checkReveal();
    } catch (err) {
      if (err?.response?.status === 401) {
        navigate("/session-expired");
        return;
      }
      setRevealError(getErrorMessage(err));
    } finally {
      setRequesting(false);
    }
  }

  if (pageState === "loading") {
    return <SkeletonCard />;
  }

  if (pageState === "integrity-failed") {
    return (
      <Banner type="danger" title="Integrity check failed">
        This report's stored data failed an integrity check and cannot be safely displayed.
        Contact an administrator.
      </Banner>
    );
  }

  if (pageState === "not-found") {
    return (
      <div>
        <h1>Report not found</h1>
        <p>This report doesn't exist.</p>
        <Link to="/reviewer">Back to dashboard</Link>
      </div>
    );
  }

  if (pageState === "error") {
    return (
      <Banner
        type="warning"
        title="Something went wrong"
        actions={
          <button type="button" className="btn btn-secondary btn-small" onClick={loadReport}>
            Retry
          </button>
        }
      >
        {error}
      </Banner>
    );
  }

  const currentIndex = STATUS_ORDER.indexOf(report.status);

  return (
    <div>
      <div className="page-header">
        <h1>{report.title}</h1>
        <StatusPill status={report.status} />
      </div>

      {!report.chainVerified && (
        <Banner type="danger" title="Chain verification failed">
          This report's status history chain could not be verified. This is a security-relevant
          issue — contact an administrator.
        </Banner>
      )}

      <div className="card" style={{ marginBottom: "var(--space-5)" }}>
        <div className="field">
          <label>Category</label>
          <p>{report.category}</p>
        </div>
        <div className="field">
          <label>Description</label>
          <p style={{ whiteSpace: "pre-wrap" }}>{report.description}</p>
        </div>
        {report.evidence && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Evidence</label>
            <p style={{ whiteSpace: "pre-wrap" }}>{report.evidence}</p>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: "var(--space-5)" }}>
        <h3>Update status</h3>
        {statusError && <Banner type="danger">{statusError}</Banner>}
        <div className="row">
          <select
            className="input"
            style={{ maxWidth: 240 }}
            value={report.status}
            disabled={statusUpdating}
            onChange={(e) => handleStatusChange(e.target.value)}
          >
            {STATUS_ORDER.map((s, idx) => (
              <option key={s} value={s} disabled={idx < currentIndex}>
                {s}
              </option>
            ))}
          </select>
          {statusUpdating && <ButtonSpinner />}
        </div>
        <p className="field-hint">Status can only move forward: Open → Investigating → Resolved.</p>
      </div>

      <p>
        <Link to={`/reviewer/reports/${id}/history`}>View status history</Link>
      </p>

      {report.hasIdentity && (
        <div className="card" style={{ marginTop: "var(--space-5)" }}>
          <h3>Identity reveal</h3>

          {revealState === null && <p className="text-muted">Checking reveal request status…</p>}

          {revealState === "none" && !reasonOpen && (
            <button type="button" className="btn btn-secondary" onClick={() => setReasonOpen(true)}>
              Request identity reveal
            </button>
          )}

          {revealState === "none" && reasonOpen && (
            <form onSubmit={handleRequestReveal}>
              {revealError && <Banner type="danger">{revealError}</Banner>}
              <div className="field">
                <label htmlFor="reveal-reason">
                  Reason<span className="required-mark">*</span>
                </label>
                <textarea
                  id="reveal-reason"
                  className="input"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div className="row">
                <button type="submit" className="btn btn-primary" disabled={requesting}>
                  {requesting ? (
                    <>
                      <ButtonSpinner /> Submitting…
                    </>
                  ) : (
                    "Submit request"
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setReasonOpen(false);
                    setRevealError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {revealState === "pending" && (
            <div>
              <p>
                Pending custodian approval: {revealData.approvals} of {revealData.threshold}{" "}
                approvals received.
              </p>
              <button type="button" className="btn btn-secondary btn-small" onClick={checkReveal}>
                Refresh
              </button>
            </div>
          )}

          {revealState === "denied" && (
            <Banner type="danger" title="Identity reveal denied">
              The custodians denied this reveal request.
            </Banner>
          )}

          {revealState === "approved" && (
            <div>
              <Banner type="warning" title="Identity revealed">
                This information is shown only here, only now — it is not saved anywhere in this
                app.
              </Banner>
              <p className="mono" style={{ fontSize: "var(--font-size-4)" }}>
                {revealData.identity}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
