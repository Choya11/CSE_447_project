import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api/axios.js";
import PageSpinner from "../components/Spinner.jsx";
import StatusPill from "../components/StatusPill.jsx";
import Banner from "../components/Banner.jsx";

const TIMEOUT_MS = 10000;

export default function TrackReportStatus() {
  const { trackingId } = useParams();
  const [state, setState] = useState("loading"); // loading | success | not-found | error
  const [status, setStatus] = useState(null);

  const load = useCallback(() => {
    setState("loading");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    api
      .get(`/reports/track/${encodeURIComponent(trackingId)}`, { signal: controller.signal })
      .then((response) => {
        setStatus(response.data.status);
        setState("success");
      })
      .catch((err) => {
        if (err?.response?.status === 404) {
          setState("not-found");
        } else {
          setState("error");
        }
      })
      .finally(() => clearTimeout(timer));

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trackingId]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load]);

  return (
    <div className="page-narrow">
      <h1>Report status</h1>

      {state === "loading" && <PageSpinner label="Checking status…" />}

      {state === "not-found" && (
        <Banner type="info" title="No report found">
          We couldn't find a report with that tracking ID. Double-check it and try again.
        </Banner>
      )}

      {state === "error" && (
        <Banner
          type="warning"
          title="Couldn't check status"
          actions={
            <button type="button" className="btn btn-secondary btn-small" onClick={load}>
              Retry
            </button>
          }
        >
          Something went wrong reaching the server. Please try again.
        </Banner>
      )}

      {state === "success" && (
        <div className="card" style={{ textAlign: "center" }}>
          <div className="text-muted" style={{ marginBottom: "var(--space-3)" }}>
            Tracking ID: <span className="mono">{trackingId}</span>
          </div>
          <StatusPill status={status} />
        </div>
      )}

      <div style={{ marginTop: "var(--space-6)" }}>
        <Link to="/track" className="btn btn-secondary">
          Check another ID
        </Link>
      </div>
    </div>
  );
}
