import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios.js";
import { getErrorMessage, routeOnAuthError } from "../api/errors.js";
import { SkeletonTable } from "./Skeleton.jsx";
import Banner from "./Banner.jsx";
import ConfirmModal from "./ConfirmModal.jsx";
import CopyButton from "./CopyButton.jsx";
import { ButtonSpinner } from "./Spinner.jsx";
import { ToastHost, useToast } from "./Toast.jsx";

// Shared list + create + deactivate (+ optional rotate-keys) management UI
// for /admin/reviewers and /admin/custodians — identical pattern per role.
export default function StaffManagement({ role, createPath, showKeyColumns }) {
  const navigate = useNavigate();
  const [staff, setStaff] = useState(null);
  const [error, setError] = useState(null);
  const [toast, showToast] = useToast();

  const [formOpen, setFormOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [oneTimeSecret, setOneTimeSecret] = useState(null);

  const [confirmTarget, setConfirmTarget] = useState(null); // { type: 'deactivate'|'rotate', id, username }
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(() => {
    setStaff(null);
    api
      .get(`/admin/staff?role=${role}`)
      .then((response) => setStaff(response.data.users))
      .catch((err) => {
        if (routeOnAuthError(err, navigate)) return;
        setError(getErrorMessage(err));
      });
  }, [role, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreateError(null);
    if (!username || !password || !email) {
      setCreateError("Username, password, and email are required.");
      return;
    }
    setCreating(true);
    try {
      const payload = { username, password, email };
      if (contactInfo.trim()) payload.contactInfo = contactInfo;
      const response = await api.post(createPath, payload);
      setOneTimeSecret(response.data);
      setUsername("");
      setPassword("");
      setEmail("");
      setContactInfo("");
      setFormOpen(false);
      load();
    } catch (err) {
      if (routeOnAuthError(err, navigate)) return;
      setCreateError(getErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirm() {
    if (!confirmTarget) return;
    setConfirmBusy(true);
    try {
      if (confirmTarget.type === "deactivate") {
        await api.patch(`/admin/staff/${confirmTarget.id}/deactivate`);
      } else if (confirmTarget.type === "rotate") {
        await api.post(`/admin/reviewers/${confirmTarget.id}/rotate-keys`);
      }
      setConfirmTarget(null);
      load();
      showToast(confirmTarget.type === "deactivate" ? "Account deactivated" : "Keys rotated");
    } catch (err) {
      if (routeOnAuthError(err, navigate)) return;
      setError(getErrorMessage(err));
      setConfirmTarget(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  const roleLabel = role === "reviewer" ? "reviewer" : "custodian";

  return (
    <div>
      <div className="page-header">
        <h1>{role === "reviewer" ? "Reviewers" : "Custodians"}</h1>
        <button type="button" className="btn btn-primary" onClick={() => setFormOpen((o) => !o)}>
          {formOpen ? "Cancel" : `Create ${roleLabel}`}
        </button>
      </div>

      {error && <Banner type="danger">{error}</Banner>}

      {oneTimeSecret && (
        <Banner type="warning" title="Save this now — it will not be shown again">
          <p style={{ marginBottom: "var(--space-3)" }}>
            Give this to the new {roleLabel} ({oneTimeSecret.username}) to add to their
            authenticator app.
          </p>
          <div className="field" style={{ marginBottom: "var(--space-3)" }}>
            <label>otpauth URL</label>
            <div className="row">
              <code className="mono" style={{ wordBreak: "break-all" }}>
                {oneTimeSecret.otpauthUrl}
              </code>
              <CopyButton value={oneTimeSecret.otpauthUrl} label="Copy URL" />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Raw secret</label>
            <div className="row">
              <code className="mono">{oneTimeSecret.totpSecret}</code>
              <CopyButton value={oneTimeSecret.totpSecret} label="Copy secret" />
            </div>
          </div>
          <div className="banner-actions">
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => setOneTimeSecret(null)}
            >
              I've saved it, dismiss
            </button>
          </div>
        </Banner>
      )}

      {formOpen && (
        <form onSubmit={handleCreate} className="card" style={{ marginBottom: "var(--space-5)" }}>
          {createError && <Banner type="danger">{createError}</Banner>}
          <div className="field">
            <label htmlFor="new-username">
              Username<span className="required-mark">*</span>
            </label>
            <input
              id="new-username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-email">
              Email<span className="required-mark">*</span>
            </label>
            <input
              id="new-email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-contact">Contact info (optional)</label>
            <input
              id="new-contact"
              className="input"
              value={contactInfo}
              onChange={(e) => setContactInfo(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="new-password">
              Temporary password<span className="required-mark">*</span>
            </label>
            <input
              id="new-password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ marginTop: "var(--space-5)" }}
            disabled={creating}
          >
            {creating ? (
              <>
                <ButtonSpinner /> Creating…
              </>
            ) : (
              `Create ${roleLabel}`
            )}
          </button>
        </form>
      )}

      {staff === null && !error && <SkeletonTable rows={4} />}

      {staff && staff.length === 0 && <p className="empty-state">No {roleLabel}s yet.</p>}

      {staff && staff.length > 0 && (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Status</th>
                {showKeyColumns && <th>Key version</th>}
                {showKeyColumns && <th>Active since</th>}
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.status}</td>
                  {showKeyColumns && <td className="mono">{u.keyVersion ?? "—"}</td>}
                  {showKeyColumns && (
                    <td className="mono">
                      {u.keyActiveSince ? new Date(u.keyActiveSince).toLocaleDateString() : "—"}
                    </td>
                  )}
                  <td className="mono">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-destructive btn-small"
                        disabled={u.status !== "active"}
                        onClick={() =>
                          setConfirmTarget({ type: "deactivate", id: u.id, username: u.username })
                        }
                      >
                        Deactivate
                      </button>
                      {showKeyColumns && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          onClick={() =>
                            setConfirmTarget({ type: "rotate", id: u.id, username: u.username })
                          }
                        >
                          Rotate keys
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="record-cards">
            {staff.map((u) => (
              <div key={u.id} className="record-card">
                <div className="record-card-title">{u.username}</div>
                <div className="record-card-row">
                  <span className="rc-label">Status</span>
                  <span>{u.status}</span>
                </div>
                {showKeyColumns && (
                  <div className="record-card-row">
                    <span className="rc-label">Key version</span>
                    <span className="mono">{u.keyVersion ?? "—"}</span>
                  </div>
                )}
                {showKeyColumns && (
                  <div className="record-card-row">
                    <span className="rc-label">Active since</span>
                    <span className="mono">
                      {u.keyActiveSince ? new Date(u.keyActiveSince).toLocaleDateString() : "—"}
                    </span>
                  </div>
                )}
                <div className="record-card-row">
                  <span className="rc-label">Created</span>
                  <span className="mono">{new Date(u.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="row" style={{ marginTop: "var(--space-3)" }}>
                  <button
                    type="button"
                    className="btn btn-destructive btn-small"
                    disabled={u.status !== "active"}
                    onClick={() =>
                      setConfirmTarget({ type: "deactivate", id: u.id, username: u.username })
                    }
                  >
                    Deactivate
                  </button>
                  {showKeyColumns && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() =>
                        setConfirmTarget({ type: "rotate", id: u.id, username: u.username })
                      }
                    >
                      Rotate keys
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {confirmTarget && confirmTarget.type === "deactivate" && (
        <ConfirmModal
          title="Deactivate account"
          message={`This will deactivate ${confirmTarget.username}'s account. They will no longer be able to log in. This cannot be undone from here.`}
          confirmLabel="Deactivate"
          destructive
          busy={confirmBusy}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmTarget(null)}
        />
      )}

      {confirmTarget && confirmTarget.type === "rotate" && (
        <ConfirmModal
          title="Rotate keys"
          message={`This will rotate encryption keys for ${confirmTarget.username} and re-encrypt their assigned reports. This cannot be undone.`}
          confirmLabel="Rotate keys"
          destructive
          busy={confirmBusy}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmTarget(null)}
        />
      )}

      <ToastHost message={toast} />
    </div>
  );
}
