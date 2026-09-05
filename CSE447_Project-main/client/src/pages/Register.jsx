import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/axios.js";
import { ButtonSpinner } from "../components/Spinner.jsx";
import Banner from "../components/Banner.jsx";

export default function Register() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!username || !password || !email) {
      setError("Username, password, and email are required.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = { username, password, email };
      if (contactInfo.trim()) payload.contactInfo = contactInfo;
      await api.post("/auth/register", payload);
      navigate("/login");
    } catch (err) {
      setError(err?.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-narrow">
      <h1>Create an account</h1>
      <p>
        An account is optional — you can submit and track a report anonymously without one. This
        is only useful if you'd like to manage reports under a registered username.
      </p>

      {error && <Banner type="danger">{error}</Banner>}

      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="username">
            Username<span className="required-mark">*</span>
          </label>
          <input
            id="username"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div className="field">
          <label htmlFor="email">
            Email<span className="required-mark">*</span>
          </label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div className="field">
          <label htmlFor="contactInfo">Contact info (optional)</label>
          <input
            id="contactInfo"
            className="input"
            value={contactInfo}
            onChange={(e) => setContactInfo(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">
            Password<span className="required-mark">*</span>
          </label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? (
            <>
              <ButtonSpinner /> Creating account…
            </>
          ) : (
            "Create account"
          )}
        </button>
      </form>

      <p style={{ marginTop: "var(--space-5)" }}>
        <Link to="/">or report anonymously without an account</Link>
      </p>
    </div>
  );
}
