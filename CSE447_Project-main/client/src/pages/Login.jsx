import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/axios.js";
import { useAuth } from "../context/AuthContext.jsx";
import { ButtonSpinner } from "../components/Spinner.jsx";
import Banner from "../components/Banner.jsx";

const ROLE_HOME = {
  reviewer: "/reviewer",
  admin: "/admin",
  custodian: "/custodian",
  reporter: "/",
};

export default function Login() {
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pendingToken, setPendingToken] = useState(null);
  const [code, setCode] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleCredentialsSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await api.post("/auth/login", { username, password });
      if (response.data.requires2FA) {
        setPendingToken(response.data.pendingToken);
      } else {
        setUser(response.data);
        navigate(ROLE_HOME[response.data.role] || "/");
      }
    } catch (err) {
      setError(err?.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCodeSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await api.post("/auth/verify-2fa", { pendingToken, code });
      setUser(response.data);
      navigate(ROLE_HOME[response.data.role] || "/");
    } catch (err) {
      setError(err?.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (pendingToken) {
    return (
      <div className="page-narrow">
        <h1>Enter your code</h1>
        <p>Enter the 6-digit code from your authenticator app.</p>

        {error && <Banner type="danger">{error}</Banner>}

        <form onSubmit={handleCodeSubmit} noValidate>
          <div className="field">
            <label htmlFor="code">
              Authentication code<span className="required-mark">*</span>
            </label>
            <input
              id="code"
              className="input mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting || !code}>
            {submitting ? (
              <>
                <ButtonSpinner /> Verifying…
              </>
            ) : (
              "Verify"
            )}
          </button>
        </form>
        <button
          type="button"
          className="btn-link"
          style={{ marginTop: "var(--space-4)" }}
          onClick={() => {
            setPendingToken(null);
            setCode("");
            setError(null);
          }}
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="page-narrow">
      <h1>Staff login</h1>

      {error && <Banner type="danger">{error}</Banner>}

      <form onSubmit={handleCredentialsSubmit} noValidate>
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
          <label htmlFor="password">
            Password<span className="required-mark">*</span>
          </label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={submitting || !username || !password}
        >
          {submitting ? (
            <>
              <ButtonSpinner /> Signing in…
            </>
          ) : (
            "Log in"
          )}
        </button>
      </form>

      <p style={{ marginTop: "var(--space-5)" }}>
        <Link to="/">Back to home</Link>
      </p>
    </div>
  );
}
