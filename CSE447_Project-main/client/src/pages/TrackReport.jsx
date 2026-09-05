import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function TrackReport() {
  const navigate = useNavigate();
  const [trackingId, setTrackingId] = useState("");
  const [touched, setTouched] = useState(false);

  const error = touched && !trackingId.trim() ? "Enter a tracking ID." : null;

  function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (!trackingId.trim()) return;
    navigate(`/track/${encodeURIComponent(trackingId.trim())}`);
  }

  return (
    <div className="page-narrow">
      <h1>Track a report</h1>
      <p>Enter the tracking ID you received when you submitted your report.</p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="trackingId">
            Tracking ID<span className="required-mark">*</span>
          </label>
          <input
            id="trackingId"
            className={`input mono ${error ? "has-error" : ""}`}
            value={trackingId}
            onChange={(e) => setTrackingId(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={!!error}
            aria-describedby={error ? "trackingId-error" : undefined}
          />
          {error && (
            <div className="field-error" id="trackingId-error">
              ⚠ {error}
            </div>
          )}
        </div>
        <button type="submit" className="btn btn-primary btn-block">
          Check status
        </button>
      </form>
    </div>
  );
}
