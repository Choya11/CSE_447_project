# Backend Design & Data Model — Whistleblower / Anonymous Reporting Tool

Document 05/06. Companion to the PRD (01/06), TDD (02/06), App Flow (03/06), and Design Brief (04/06). Stack: MongoDB (Atlas), Express, Node.js.

---

## 0. Field-level clarification carried over from the TDD

The TDD's collection sketch listed `title` alongside `ciphertextBody` in a way that left it ambiguous whether the title is encrypted. This document resolves it: **`title` and `description` are both inside `ciphertextBody`** (encrypted as one blob per PRD Goal 2 — report content must be unreadable by anyone except an assigned reviewer). Only **`category`** stays plaintext, because triage/filtering needs it and a category alone (e.g. "safety," "financial") isn't identity-revealing. This is called out explicitly because it's exactly the kind of ambiguity that causes a developer to accidentally leave something sensitive in plaintext.

---

## 1. Collections (Tables)

### `users` — Reviewer, Admin, Custodian accounts only (Reporters have no account)

| Field              | Type / rule                                                                           | Purpose                                |
| ------------------ | ------------------------------------------------------------------------------------- | -------------------------------------- |
| `_id`              | ObjectId, primary key                                                                 | Stable identifier                      |
| `role`             | enum: `reviewer`\|`admin`\|`custodian`, not null                                      | Access-control role                    |
| `email`            | string, unique index, not null                                                        | Login identifier, notification address |
| `passwordHash`     | string, not null, never returned by any API response                                  | Bcrypt/argon2 hash — never reversible  |
| `mfaSecret`        | string, encrypted at rest, not null once enrolled                                     | TOTP seed                              |
| `status`           | enum: `pending_verification`\|`active`\|`deactivated`, default `pending_verification` | Account lifecycle state                |
| `failedLoginCount` | int, default 0                                                                        | Lockout tracking                       |
| `lockedUntil`      | timestamp, nullable                                                                   | Temporary lockout expiry               |
| `createdAt`        | timestamp with time zone                                                              | Creation time                          |
| `updatedAt`        | timestamp with time zone                                                              | Last server-side change                |

Cardinality: one `users` (role=reviewer) ↔ one active `reviewerKeys` document (1:1 active, 1:N historical versions). One `users` (role=custodian) ↔ shares in `custodianKeys` (N:1, since a custodian key may be split across several custodians).

### `reviewerKeys`

| Field                 | Type / rule                                        | Purpose                                     |
| --------------------- | -------------------------------------------------- | ------------------------------------------- |
| `_id`                 | ObjectId, PK                                       | Stable identifier                           |
| `reviewerId`          | ObjectId, FK → `users._id`, indexed                | Owning reviewer                             |
| `algorithm`           | string, not null, e.g. `RSA-OAEP-4096`             | Wrapping algorithm                          |
| `publicKey`           | string, not null                                   | Used by submission flow to wrap report keys |
| `encryptedPrivateKey` | string, not null, encrypted under `KMS_MASTER_KEY` | Never sent to any client in plaintext       |
| `version`             | int, not null                                      | Referenced by `reports.wrapKeyVersion`      |
| `status`              | enum: `active`\|`rotated`\|`revoked`, not null     | Rotation state                              |
| `createdAt`           | timestamp                                          | Creation time                               |
| `rotatedAt`           | timestamp, nullable                                | When superseded                             |

### `custodianKeys`

| Field                       | Type / rule                                | Purpose                                               |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| `_id`                       | ObjectId, PK                               | Stable identifier                                     |
| `algorithm`                 | string, e.g. `ECIES-secp256r1`             | Identity-field encryption scheme                      |
| `publicKey`                 | string, not null                           | Used to encrypt `reportIdentities.ciphertextIdentity` |
| `encryptedPrivateKeyShares` | array of `{custodianId, share}`, not empty | k-of-n split custody                                  |
| `threshold`                 | int, not null                              | Minimum shares needed to decrypt (PRD FR-08)          |
| `version`                   | int, not null                              | Referenced by `reportIdentities.custodianKeyVersion`  |
| `status`                    | enum: `active`\|`rotated`, not null        | Rotation state                                        |
| `createdAt`                 | timestamp                                  | Creation time                                         |

### `reports`

| Field                | Type / rule                                                        | Purpose                                                   |
| -------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| `_id`                | ObjectId, PK                                                       | Internal identifier — never exposed to the reporter       |
| `trackingId`         | string, unique index, 128-bit random, not null                     | The _only_ reporter-facing identifier                     |
| `category`           | enum: `safety`\|`harassment`\|`financial`\|`other`, not null       | Plaintext — triage/filtering only (see §0)                |
| `ciphertextBody`     | string (base64), not null                                          | Encrypted title + description + evidence text             |
| `nonce`              | string, not null                                                   | AES-GCM nonce                                             |
| `authTag`            | string, not null                                                   | AES-GCM auth tag                                          |
| `wrappedKey`         | string, not null                                                   | Report AES key, RSA-OAEP-wrapped for `assignedReviewerId` |
| `wrapKeyVersion`     | int, not null                                                      | Which `reviewerKeys.version` performed the wrap           |
| `hmac`               | string, not null                                                   | Integrity check, recomputed on every read                 |
| `status`             | enum: `submitted`\|`under_review`\|`resolved`, default `submitted` | Workflow state                                            |
| `assignedReviewerId` | ObjectId, FK → `users._id`, nullable, indexed                      | Null until triaged/assigned                               |
| `createdAt`          | timestamp                                                          | Creation time                                             |
| `updatedAt`          | timestamp                                                          | Last server-side change (status, reassignment, re-wrap)   |

Cardinality: one `reports` ↔ zero-or-one `reportIdentities`; one `reports` ↔ many `statusLog`; one `reports` ↔ many `readReceipts`; one `reports` ↔ zero-or-many `revealRequests`.

### `reportIdentities` (nullable — only if reporter opted in)

| Field                 | Type / rule                                | Purpose                                                |
| --------------------- | ------------------------------------------ | ------------------------------------------------------ |
| `reportId`            | ObjectId, FK → `reports._id`, unique index | 1:0..1 with reports                                    |
| `ciphertextIdentity`  | string (base64), not null                  | ECIES-encrypted identity info                          |
| `ephemeralPubKey`     | string, not null                           | ECIES ephemeral key                                    |
| `nonce` / `authTag`   | string, not null                           | AES-GCM parameters within ECIES construction           |
| `custodianKeyVersion` | int, not null                              | Which `custodianKeys.version` this was encrypted under |
| `createdAt`           | timestamp                                  | Creation time                                          |

### `statusLog` — append-only, hash-chained (no update/delete route exists)

| Field           | Type / rule                           | Purpose                                                                                  |
| --------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `_id`           | ObjectId, PK                          | Stable identifier                                                                        |
| `reportId`      | ObjectId, FK → `reports._id`, indexed | Which report this entry belongs to                                                       |
| `prevEntryHash` | string, not null                      | Chain link to prior entry (or `reports.hmac` for the genesis entry)                      |
| `entryHash`     | string, not null                      | `HMAC(prevEntryHash \|\| status \|\| actorId \|\| timestamp)`                            |
| `status`        | string, not null                      | New status or event type (includes `reveal_requested`/`reveal_approved`/`reveal_denied`) |
| `actorId`       | ObjectId, FK → `users._id`, not null  | Who performed the action                                                                 |
| `signature`     | string, not null                      | Actor's signature over the entry, non-repudiation                                        |
| `timestamp`     | timestamp                             | When it happened                                                                         |

### `readReceipts`

| Field        | Type / rule                           | Purpose                 |
| ------------ | ------------------------------------- | ----------------------- |
| `_id`        | ObjectId, PK                          | Stable identifier       |
| `reportId`   | ObjectId, FK → `reports._id`, indexed | Which report was opened |
| `reviewerId` | ObjectId, FK → `users._id`            | Who opened it           |
| `openedAt`   | timestamp                             | When                    |

### `revealRequests`

| Field                      | Type / rule                                              | Purpose                                                                                                                                   |
| -------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `_id`                      | ObjectId, PK                                             | Stable identifier                                                                                                                         |
| `reportId`                 | ObjectId, FK → `reports._id`, indexed                    | Target report                                                                                                                             |
| `requestedBy`              | ObjectId, FK → `users._id`, not null                     | Reviewer or admin who initiated it                                                                                                        |
| `reason`                   | string, nullable, short free text                        | Stated justification (metadata-level, kept generic — not a substitute for report content)                                                 |
| `status`                   | enum: `pending`\|`approved`\|`denied`, default `pending` | Workflow state                                                                                                                            |
| `threshold`                | int, not null                                            | Copied from `custodianKeys.threshold` at request time (so a later key rotation doesn't retroactively change an in-flight request's rules) |
| `approvals`                | array of `{custodianId, decision, decidedAt, signature}` | One entry per custodian action                                                                                                            |
| `createdAt` / `resolvedAt` | timestamp, `resolvedAt` nullable until closed            | Lifecycle timestamps                                                                                                                      |

### `auditLog` — admin-visible, content-free by construction (no field exists here that could hold report content)

| Field        | Type / rule                                                                                  | Purpose                                 |
| ------------ | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| `_id`        | ObjectId, PK                                                                                 | Stable identifier                       |
| `actorId`    | ObjectId, FK → `users._id`, nullable (null for system events)                                | Who/what triggered it                   |
| `action`     | string, not null, e.g. `report_status_updated`, `key_rotated`, `unauthorized_access_attempt` | Event type                              |
| `targetType` | string, not null                                                                             | e.g. `report`, `reviewerKey`, `user`    |
| `targetId`   | ObjectId, not null                                                                           | Which resource                          |
| `timestamp`  | timestamp                                                                                    | When                                    |
| `hmac`       | string, not null                                                                             | Same tamper-evidence pattern as reports |

---

## 2. Access Matrix

| Resource / action                                     | Reporter                                                                        | Reviewer                                                                 | Admin                                                                                                      | Custodian                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `reports` — create                                    | **Allowed** (unauthenticated, via submission form)                              | Not allowed                                                              | Not allowed                                                                                                | Not allowed                                                                                                                  |
| `reports` — read (ciphertext/content)                 | Not allowed (only `status` via trackingId, a different response shape entirely) | **Own assigned only**, enforced server-side by query filter              | **Never** — schema/response shape excludes ciphertext fields entirely                                      | **Never** — no route grants custodians report content access                                                                 |
| `reports` — read (status only, via `trackingId`)      | **Allowed**, no auth                                                            | N/A (uses `:id` route instead)                                           | N/A                                                                                                        | N/A                                                                                                                          |
| `reports` — update (status)                           | Not allowed                                                                     | **Own assigned only**, audited                                           | **Reassignment only** (`assignedReviewerId`), audited — not status/content                                 | Not allowed                                                                                                                  |
| `reports` — delete                                    | Not supported in V1 for any role — see §7 Retention                             |
| `reportIdentities` — create                           | Implicit, part of `POST /reports` if identity supplied                          | N/A                                                                      | N/A                                                                                                        | N/A                                                                                                                          |
| `reportIdentities` — read (plaintext)                 | Never                                                                           | Only as the original requester, after threshold met via `revealRequests` | Only as the original requester, after threshold met                                                        | Never persisted in plaintext even by custodian — decryption happens transiently, result delivered to requester only (see §5) |
| `statusLog` — create                                  | N/A (system-generated on every action)                                          |
| `statusLog` — read                                    | Not allowed                                                                     | **Own assigned reports only**                                            | **All entries**, metadata-level (status/actor/timestamp — no report content lives here)                    | Own `revealRequests`-related entries only                                                                                    |
| `statusLog` — update/delete                           | **Nobody** — immutable by design, enforced by having no update/delete route     |
| `revealRequests` — create                             | Not allowed                                                                     | **Allowed**, for reports they're assigned to                             | Allowed                                                                                                    | Not allowed                                                                                                                  |
| `revealRequests` — read                               | Not allowed                                                                     | Own requests only                                                        | All (metadata)                                                                                             | **Pending queue relevant to them**                                                                                           |
| `revealRequests` — update (approve/deny)              | Not allowed                                                                     | Not allowed                                                              | Not allowed                                                                                                | **Allowed**, own decision only, audited, irreversible                                                                        |
| `users` (staff accounts) — create                     | N/A                                                                             | Not allowed                                                              | **Allowed** (invite-only, see §3)                                                                          | Not allowed                                                                                                                  |
| `users` — read                                        | N/A                                                                             | Own profile only                                                         | **All staff accounts**                                                                                     | Own profile only                                                                                                             |
| `users` — update                                      | N/A                                                                             | Own password/MFA only, reauth required                                   | Role/status changes, audited                                                                               | Own password/MFA only                                                                                                        |
| `users` — delete                                      | N/A                                                                             | Not allowed                                                              | **Deactivate only** — hard delete blocked if any `statusLog`/`auditLog` entries reference the account (§3) | Not allowed                                                                                                                  |
| `reviewerKeys` / `custodianKeys` — read (private key) | **Nobody**, ever, via any API response                                          |
| `reviewerKeys` — rotate                               | N/A                                                                             | Not allowed                                                              | **Triggers rotation**, KMS performs it                                                                     | N/A                                                                                                                          |
| `auditLog` — read                                     | Not allowed                                                                     | Not allowed                                                              | **Allowed**, full metadata                                                                                 | Not allowed                                                                                                                  |

**SECURITY CHECK — cross-user access, tested per resource:**

- _Can Reviewer A read Reviewer B's report by editing the `:id` in the URL?_ No — `GET /reports/:id` always applies `assignedReviewerId: req.session.userId` as part of the database query itself, not as a post-fetch check. A mismatch returns 403 before any ciphertext leaves the database layer.
- _Can a reporter enumerate other reports by guessing tracking IDs?_ Mitigated by 128-bit random IDs (not sequential) plus per-IP rate limiting on `GET /reports/track/:trackingId`, and a uniform "not found" response with constant-time-ish handling so invalid vs. valid-but-wrong IDs aren't distinguishable by timing.
- _Can an Admin read report content by requesting `reports` fields directly (e.g. via a broad `find()`)?_ No — the admin-scoped DB connection/query layer only ever projects fields present in the metadata shape; `ciphertextBody`, `nonce`, `authTag`, `wrappedKey` are excluded at the query-construction level for any admin-authenticated request, not filtered client-side.
- _Can a Custodian read report content instead of just the identity field?_ No — custodians have no route that touches the `reports` collection at all; their entire surface is `revealRequests` and, upon threshold approval, a one-time decrypt operation scoped to `reportIdentities` only.

---

## 3. Account Lifecycle

**Reporters:** no account exists — "signup," "login," and "recovery" are not applicable concepts for this role by design (PRD Goal 1). The only reporter-facing credential is the tracking ID itself, generated once and never recoverable.

**Reviewer / Admin / Custodian accounts:**

- **Signup:** invite-only. There is no public registration route — an Admin creates the account (`POST /admin/reviewers` or equivalent for custodian/admin roles). This is a deliberate constraint: a whistleblower system with open self-registration for reviewer-level access would be a serious hole.
- **Verification:** account starts in `pending_verification`; the invitee receives an emailed verification link, sets their password, and enrolls TOTP MFA before the account becomes `active`. No login is possible before MFA enrollment completes.
- **Login:** password + TOTP required every session (PRD FR-03). Rate-limited; `failedLoginCount` increments on failure, account locks (`lockedUntil`) after a threshold, event written to `auditLog`.
- **Recovery:**
  - _Forgotten password:_ emailed one-time reset link, standard expiry (e.g. 1 hour), invalidated after use.
  - _Lost MFA device:_ **no self-service bypass** — this would undermine the whole 2FA guarantee. Requires Admin-assisted re-enrollment after out-of-band identity verification, itself an audited action.
- **Session expiry:** short-lived access token (~15 min) + refresh token (~8 hours, roughly a working day), refresh blocked if `status` is no longer `active`.
- **Account deletion:** Admin can **deactivate** (`status: deactivated`, login blocked immediately) at any time. **Hard delete is only permitted if the account has zero associated `statusLog`/`auditLog`/`revealRequests` entries** — otherwise deleting the row would break the hash-chain's `actorId` references and the audit trail's integrity. In practice this means any account that's ever done real work is deactivated, never deleted.

---

## 4. Server/DB-Side Authorization (not hidden UI alone)

Every authorization decision in this system is enforced at the query/middleware layer, never only by hiding a button in the UI:

- Role checks happen in Express middleware on every route, reading role from the verified session token — never from a client-supplied field.
- Ownership/assignment checks (e.g. "is this reviewer assigned to this report") are built into the **database query itself** (`find({_id, assignedReviewerId: session.userId})`), so a mismatched request returns zero rows rather than fetching-then-checking.
- Admin's content-blindness is enforced by using a **separate query/response path** that never selects content fields, not a shared query with fields stripped afterward — this was the explicit TDD decision (§7, "MongoDB collection separation for admin content-blindness") and it applies to every admin-facing route, not just the obvious ones.
- Custodian actions on `revealRequests` are the only writes permitted to that collection's `approvals` array, enforced by role check plus a check that the requesting custodian hasn't already voted on this request (idempotency, see §5).

---

## 5. API Contracts

| Endpoint                                       | Request                                                                                         | Validation                                                                                                              | Success                                                                                       | Error codes                                                                                                                         | Idempotency                                                                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /reports`                                | `{category, ciphertextBody, nonce, authTag, wrappedKey, wrapKeyVersion, hmac, reportIdentity?}` | `category` in enum; all crypto fields present and correctly typed; size limits on `ciphertextBody`                      | `201 {trackingId}`                                                                            | `400` missing/malformed field; `429` rate-limited; `500` generic                                                                    | Not idempotent by design — each call creates a new report; client should not auto-retry blindly on ambiguous failures (show explicit retry to the reporter instead, per App Flow §3) |
| `GET /reports/track/:trackingId`               | —                                                                                               | `trackingId` format check                                                                                               | `200 {status}`                                                                                | `404` generic "not found" (covers invalid, expired, and non-existent alike); `429`                                                  | Safe/idempotent (read-only)                                                                                                                                                          |
| `GET /reports/:id`                             | Auth: reviewer session                                                                          | `:id` valid ObjectId                                                                                                    | `200 {ciphertextBody, nonce, authTag, wrappedKey, wrapKeyVersion, status, integrityOk: true}` | `401` no session; `403` not assigned; `409` `integrityOk: false` payload when HMAC mismatch (content withheld); `404` doesn't exist | Safe/idempotent                                                                                                                                                                      |
| `PATCH /reports/:id/status`                    | `{status}`                                                                                      | `status` in enum; must be a valid forward transition (no skipping backward from `resolved` to `submitted`, for example) | `200 {status, statusLogEntry}`                                                                | `400` invalid transition; `401`/`403` as above                                                                                      | **Idempotent on retry with the same target status** — re-submitting the same status value returns the current state rather than appending a duplicate log entry                      |
| `POST /reports/:id/reveal-identity`            | `{reason?}`                                                                                     | Report must have a `reportIdentities` document; requester must be assigned reviewer or admin                            | `201 {revealRequestId, status: pending}`                                                      | `400` no identity field exists for this report; `403`                                                                               | Not idempotent — each call creates a new request; UI should disable re-submission while one is pending                                                                               |
| `POST /custodian/reveal-requests/:id/decision` | `{decision: approve\|deny, signature}`                                                          | Custodian must not have already voted on this request                                                                   | `200 {status, approvalsCount, threshold}`                                                     | `403` not a custodian / already voted; `409` request already resolved                                                               | **Idempotent per custodian** — a custodian's vote is recorded once; resubmission returns the existing recorded decision rather than double-counting                                  |
| `POST /auth/login`                             | `{email, password}`                                                                             | Standard                                                                                                                | `200` (triggers 2FA challenge, not full session yet)                                          | `401` invalid credentials (generic message, doesn't reveal which field was wrong); `423` account locked                             | N/A                                                                                                                                                                                  |
| `POST /auth/login/verify`                      | `{challengeToken, totpCode}`                                                                    | 6-digit TOTP format                                                                                                     | `200 {accessToken, refreshToken}`                                                             | `401` invalid code; `423` locked                                                                                                    | N/A                                                                                                                                                                                  |
| `POST /auth/refresh`                           | `{refreshToken}`                                                                                | Token signature + expiry + account still `active`                                                                       | `200 {accessToken}`                                                                           | `401` expired/invalid; `403` account deactivated                                                                                    | Safe to retry                                                                                                                                                                        |
| `POST /admin/reviewers`                        | `{email, role}`                                                                                 | Admin only; email uniqueness                                                                                            | `201 {userId}`                                                                                | `409` email exists; `403`                                                                                                           | Not idempotent — duplicate calls would be caught by the unique index and return `409`                                                                                                |
| `POST /admin/reviewers/:id/rotate-key`         | —                                                                                               | Admin only                                                                                                              | `202 {rotationStatus: in_progress}` (async for reviewers with many reports, per App Flow §3)  | `403`; `404`                                                                                                                        | **Idempotent** — re-triggering while a rotation is in progress returns the current progress rather than starting a second, conflicting rotation (TDD §7 decision)                    |
| `GET /admin/audit-log`                         | Query params: date range, actor, action type                                                    | Admin only                                                                                                              | `200 {entries[]}`                                                                             | `403`                                                                                                                               | Safe/idempotent                                                                                                                                                                      |

All endpoints return a consistent error envelope `{error: {code, message}}` where `message` is written for the interface's voice (per Design Brief tone rules) — never a raw stack trace or DB error string.

---

## 6. Indexes (based on real query patterns)

| Index                                  | Collection       | Query pattern it serves                                                    |
| -------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `{trackingId: 1}` unique               | `reports`        | Reporter status lookup — the single highest-frequency unauthenticated read |
| `{assignedReviewerId: 1}`              | `reports`        | Reviewer Dashboard's "my assigned reports" list                            |
| `{status: 1}`                          | `reports`        | Admin Dashboard counts, reviewer status filter                             |
| `{reportId: 1, timestamp: 1}` compound | `statusLog`      | Fetching a report's ordered history (App Flow "Report History" screen)     |
| `{email: 1}` unique                    | `users`          | Login lookup                                                               |
| `{status: 1, reportId: 1}` compound    | `revealRequests` | Custodian Queue's "pending requests" view, and per-report request lookups  |
| `{timestamp: -1}`                      | `auditLog`       | Admin Audit Log's recent-first browsing (App Flow)                         |
| `{actorId: 1}`                         | `auditLog`       | Filtering audit history by staff member                                    |
| `{reportId: 1}`                        | `readReceipts`   | Per-report read-receipt display                                            |

---

## 7. Files, Events, Webhooks, Audit Logs, Backups, Retention, Deletion

**Files:** none in V1 — file/evidence upload is an explicit non-goal (PRD). If added later, it needs its own encrypted blob storage decision (likely client-side encryption before upload to object storage, same trust-boundary principle as everything else here) — not covered by this document yet.

**Events:** internal application events (`report_submitted`, `report_status_updated`, `key_rotated`, `reveal_requested`, `reveal_approved`, `reveal_denied`, `unauthorized_access_attempt`) drive `auditLog` writes in-process. No external event bus/queue is needed at this system's expected scale (TDD §6).

**Webhooks:** none in V1 — no external system needs push notifications. Email (SMTP) is the only outbound channel, used exclusively for account-lifecycle messages (invite, password reset, lockout notice) — **never** report content or status details, since email is a weaker trust boundary than the app itself.

**Audit logs:** append-only, admin-read-only, content-free by construction (§1). This is the record an organization would produce if ever asked "prove no one tampered with this."

**Backups:** MongoDB Atlas automated snapshots (per the uploaded `.env`, this project already uses Atlas). Because `ciphertextBody`, `wrappedKey`, and `reportIdentities` fields are encrypted _before_ they ever reach MongoDB, a backup (or a backup leak) exposes only ciphertext and metadata — the backup itself never becomes a plaintext-content risk. Snapshot retention window is an Atlas configuration decision, not yet made — tie this to the broader retention policy below rather than setting it independently.

**Retention:** **still an open question inherited from the PRD** — this document can't finalize it, but flags the concrete shape of the decision needed: how long do `resolved` reports, their `statusLog`, and `auditLog` entries persist? Provisional default for V1: **no automatic deletion**, since premature deletion is a bigger risk than storage growth at this scale — but this needs an explicit organizational/legal decision before launch, not a default that quietly becomes permanent policy.

**Deletion:** there is deliberately **no hard-delete endpoint** for `reports`, `statusLog`, or `auditLog` in V1 — allowing deletion would directly undermine the tamper-evidence guarantee those structures exist to provide. If a future legal obligation (e.g. a right-to-erasure request) requires making a specific report unreadable, the correct mechanism is **crypto-shredding**: destroy the report's `wrappedKey` (and, if relevant, the `reportIdentities` ciphertext's decryption path) so the ciphertext becomes permanently unreadable _without deleting the row or breaking the hash chain_. This preserves the audit trail's structural integrity while still honoring an erasure requirement. This tension (audit integrity vs. erasure obligations) is worth surfacing to whoever owns legal/compliance before this system handles real reports.

---

## 8. Sensitive-Data Classification & Third-Party Boundaries

| Classification                                               | Fields                                                                                                                                                          | Handling                                                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Highly sensitive — never plaintext at rest, never logged** | `reports.ciphertextBody` (title/description/evidence), `reportIdentities.ciphertextIdentity`, all private key material, `users.mfaSecret`, `users.passwordHash` | Encrypted client-side (report/identity content) or at-rest under KMS (keys/MFA secrets); `passwordHash` is a one-way hash, never decrypted at all |
| **Sensitive — access-restricted, not content-encrypted**     | `users.email`, session/refresh tokens                                                                                                                           | Restricted by role + session validity; tokens are short-lived and signed, not stored in plaintext beyond their signed form                        |
| **Low sensitivity — plaintext, role-restricted only**        | `reports.category`, `status`, `createdAt`/`updatedAt`, assignment fields, `auditLog` entries                                                                    | No encryption needed — restricted by RBAC alone, since none of this is identity- or content-revealing on its own                                  |

**Third-party boundaries:**

- **MongoDB Atlas** is a data processor that only ever sees ciphertext + metadata (per §7) — worth listing explicitly as a sub-processor in any privacy documentation the organization publishes.
- **SMTP relay** sees only account-lifecycle email content (invite/reset/lockout notices) — never anything report-related. This boundary should be enforced by construction (the email-sending code path simply has no access to report data), not just by convention.
- **Any future analytics tool** (PRD's `report_submit_started`/`report_submit_succeeded` events, etc.) must remain both content-free _and_ tracking-ID-free — an analytics event tied to a specific tracking ID would create a re-identification path outside the encryption model entirely. This is a rule for whatever analytics choice is made later, not just a today's-implementation detail, and should be enforced at the point events are emitted, not left to configuration.
- No other third party is in scope for V1 — no payment processor, no external identity provider, no file storage vendor (see §7).
