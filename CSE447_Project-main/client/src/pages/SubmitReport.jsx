import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios.js";
import { ButtonSpinner } from "../components/Spinner.jsx";
import Banner from "../components/Banner.jsx";

const CATEGORIES = [
  "Harassment",
  "Financial misconduct",
  "Safety violation",
  "Discrimination",
  "Other",
];

export default function SubmitReport() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [evidence, setEvidence] = useState("");
  const [identity, setIdentity] = useState("");
  const [identityOpen, setIdentityOpen] = useState(false);

  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState(null);

  function fieldError(name) {
    if (!touched[name]) return null;
    if (name === "title" && !title.trim()) return "Title is required.";
    if (name === "description" && !description.trim()) return "Description is required.";
    if (name === "category" && !category) return "Please select a category.";
    return null;
  }

  function markTouched(name) {
    setTouched((t) => ({ ...t, [name]: true }));
  }

  function validate() {
    const next = { title: true, description: true, category: true };
    setTouched(next);
    return title.trim() && description.trim() && category;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorBanner(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const payload = { title, description, category };
      if (evidence.trim()) payload.evidence = evidence;
      if (identity.trim()) payload.identity = identity;

      const response = await api.post("/reports", payload);
      navigate("/submit/confirmation", { state: { trackingId: response.data.trackingId } });
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) {
        setErrorBanner("Too many submissions right now. Please wait a moment and try again.");
      } else if (status === 400) {
        setErrorBanner(err.response?.data?.error || "Please check the form and try again.");
      } else {
        setErrorBanner(
          "We couldn't submit your report — nothing was sent. Your entries below are preserved; please try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-narrow">
      <h1>Submit a report</h1>
      <p>
        Share as much detail as you're comfortable with. You do not need to create an account, and
        you may skip the identity section entirely.
      </p>

      {errorBanner && (
        <Banner type="danger" title="Submission failed">
          {errorBanner}
        </Banner>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="title">
            Title<span className="required-mark">*</span>
          </label>
          <input
            id="title"
            className={`input ${fieldError("title") ? "has-error" : ""}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => markTouched("title")}
            aria-invalid={!!fieldError("title")}
            aria-describedby={fieldError("title") ? "title-error" : undefined}
          />
          {fieldError("title") && (
            <div className="field-error" id="title-error">
              ⚠ {fieldError("title")}
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="description">
            Description<span className="required-mark">*</span>
          </label>
          <textarea
            id="description"
            className={`input ${fieldError("description") ? "has-error" : ""}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => markTouched("description")}
            aria-invalid={!!fieldError("description")}
            aria-describedby={fieldError("description") ? "description-error" : undefined}
            rows={6}
          />
          {fieldError("description") && (
            <div className="field-error" id="description-error">
              ⚠ {fieldError("description")}
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="category">
            Category<span className="required-mark">*</span>
          </label>
          <select
            id="category"
            className={`input ${fieldError("category") ? "has-error" : ""}`}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            onBlur={() => markTouched("category")}
            aria-invalid={!!fieldError("category")}
            aria-describedby={fieldError("category") ? "category-error" : undefined}
          >
            <option value="">Select a category…</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {fieldError("category") && (
            <div className="field-error" id="category-error">
              ⚠ {fieldError("category")}
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="evidence">Evidence (optional)</label>
          <textarea
            id="evidence"
            className="input"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            rows={4}
          />
          <div className="field-hint">Describe any supporting evidence in text. File upload isn't supported.</div>
        </div>

        <div className="surface-sunken" style={{ marginBottom: "var(--space-5)" }}>
          <button
            type="button"
            className="btn-link"
            onClick={() => setIdentityOpen((o) => !o)}
            aria-expanded={identityOpen}
            aria-controls="identity-panel"
          >
            {identityOpen ? "Hide" : "Add identifying info (optional)"}
          </button>
          {identityOpen && (
            <div id="identity-panel" style={{ marginTop: "var(--space-4)" }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="identity">Identity (optional)</label>
                <textarea
                  id="identity"
                  className="input"
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                  rows={3}
                />
                <div className="field-hint">
                  Only shared with reviewers if explicitly approved through a separate, auditable
                  reveal process.
                </div>
              </div>
            </div>
          )}
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? (
            <>
              <ButtonSpinner /> Submitting…
            </>
          ) : (
            "Submit report"
          )}
        </button>
      </form>
    </div>
  );
}
