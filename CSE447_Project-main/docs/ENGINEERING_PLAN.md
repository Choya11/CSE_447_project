# Engineering Implementation Plan — Whistleblower / Anonymous Reporting Tool

Document 06/06. Companion to PRD (01), TDD (02), App Flow (03), Design Brief (04), Backend Design (05). Stack: MERN.

Scope discipline: nothing below builds toward a non-goal (no multi-tenant, no file uploads, no GraphQL, no reporter messaging, no custom RBAC roles — PRD §Non-goals). Where a design doc left a decision open (retention policy, custodian identity, hosting platform, data residency), the task that needs it is marked **BLOCKED ON: <open question>** rather than guessed into existence.

**⚠️ Before task F-01:** the uploaded `.env` contains what look like live credentials — an Atlas connection string with a real password, `SESSION_SECRET`, and `KEY_ENCRYPTION_SECRET`. Treat all three as compromised the moment they left a private secrets store (which sharing them in a doc did). Rotate them in Atlas / your secrets manager before any other work, regardless of whether this plan is followed in order. This is task F-02 below, but it doesn't wait for F-01.

---

## Task template (used throughout)

```
TASK ID / OUTCOME
Areas affected:
Dependencies:
Implementation notes:
Acceptance criteria:
Tests required:
Security / privacy checks:
Observability:
Rollback or recovery:
Done evidence:
Open questions:
```

## Definition of done (applies to every task below)

Acceptance criteria pass and failure states work · relevant unit/integration/e2e tests pass · authorization and validation are enforced server-side, not just hidden in the UI · logs help debugging without leaking sensitive data · affected source docs (01–06) are updated if the task changes a decision · the change can be deployed and rolled back safely.

---

## Phase 0 — Foundation

### F-01 / Repo, skeleton apps, tooling

Areas affected: repo root, `/client`, `/server`.
Dependencies: none.
Implementation notes: two-package repo (Express API, Vite React SPA); ESLint + Prettier shared config; `.env.example` with placeholder values only — never real ones, and it's gitignored alongside `.env`.
Acceptance criteria: `npm install && npm run dev` boots both apps locally from a clean clone.
Tests required: none (scaffolding).
Security / privacy checks: confirm `.gitignore` excludes `.env*`; confirm no secret is committed (grep history before first push).
Observability: n/a.
Rollback or recovery: n/a, pre-deploy.
Done evidence: clean-clone boot screen recording or CI log.
Open questions: none.

### F-02 / Secrets rotated and moved to per-environment storage

Areas affected: Atlas cluster, deployment platform's secret store.
Dependencies: none — do this first, independent of task order.
Implementation notes: rotate the Mongo user password, regenerate `SESSION_SECRET` and `KEY_ENCRYPTION_SECRET`/`KMS_MASTER_KEY`; store per-environment (dev/staging/prod each get their own values, per TDD §6) in the host's secret manager, not in any `.env` file that leaves a developer's machine.
Acceptance criteria: old Mongo credential no longer authenticates; app boots against new credentials in every environment.
Tests required: connection smoke test per environment.
Security / privacy checks: confirm old values are unusable; confirm no service still references them (search codebase and CI config).
Observability: log a one-time audit note (who rotated, when) — not the values.
Rollback or recovery: keep old credentials valid for a short overlap window only if a live cutover requires it, then revoke.
Done evidence: rotation timestamp + confirmation the old password fails.
Open questions: none — this is not optional.

### F-03 / CI pipeline

Areas affected: `.github/workflows`.
Dependencies: F-01.
Implementation notes: GitHub Actions — install, lint, unit tests, build, on every PR; block merge on red.
Acceptance criteria: a failing test blocks merge; a passing PR shows green before merge is allowed.
Tests required: a deliberately-failing test in a scratch branch to prove the gate works, then removed.
Security / privacy checks: CI secrets (test-only Mongo URI, etc.) come from GitHub Actions secrets, never checked in.
Observability: CI run history is the observability here.
Rollback or recovery: revert the workflow file if it blocks all merges incorrectly.
Done evidence: link to a green CI run and a blocked red one.
Open questions: none.

### F-04 / Baseline observability

Areas affected: `/server` logging middleware.
Dependencies: F-01.
Implementation notes: structured JSON logs (`pino`), request-id per request, `GET /healthz`. Log fields limited to route, status code, actor id, timestamp, request id — never request/response bodies (TDD §5, enforced from day one so it's never retrofitted).
Acceptance criteria: a request produces one structured log line with no payload fields; `/healthz` returns 200 when DB is reachable, 503 when not.
Tests required: unit test asserting the logger's field allowlist; integration test hitting `/healthz` with DB down.
Security / privacy checks: manual review that no log statement anywhere interpolates a request/response body.
Observability: this task _is_ the observability baseline everything else builds on.
Rollback or recovery: n/a.
Done evidence: sample log line + healthz test output.
Open questions: none.

---

## Phase 1 — Thin end-to-end slice

### S-01 / Reporter can submit a report and check its status, full stack, no auth

Areas affected: `/client` Home, Submit, Confirmation, Track, Track Result screens; `POST /reports`; `GET /reports/track/:trackingId`; `reports` collection.
Dependencies: F-01…F-04.
Implementation notes: this is the one journey PRD/App Flow call out as proving the wiring before more screens exist. Client generates a report AES key, encrypts `title+description` (category stays plaintext per Backend Design §0) with WebCrypto, POSTs ciphertext + nonce + authTag + a **placeholder wrap** (real reviewer-key wrapping is deferred to CF-01 since no reviewer keys exist yet — record this explicitly, don't fake it silently). API validates, writes to Mongo, returns a 128-bit random `trackingId`. Track screen does a lookup returning status only, generic 404 for anything invalid.
Acceptance criteria: submitting valid required fields creates a `reports` document, returns a trackingId shown once, and that same ID immediately looks up as "Submitted"; a made-up ID returns the same generic 404 as an expired one.
Tests required: e2e (Playwright) covering submit → confirmation → track → result; unit tests for trackingId uniqueness/entropy and the 404 path; integration test asserting invalid vs. valid-but-wrong IDs return identical response shape and comparable timing.
Security / privacy checks: confirm plaintext title/description never reach the server (inspect network payload in the e2e test); rate limit both endpoints per IP.
Observability: log `report_submit_succeeded`/`failed` and `status_check_performed` as event-only, no field values (per App Flow analytics notes).
Rollback or recovery: feature is additive; disable via a route flag if a regression ships.
Done evidence: e2e recording, network payload snippet showing ciphertext only.
Open questions: none — placeholder wrap is closed out by CF-01.

---

## Phase 2 — Identity and access

### IA-01 / Staff accounts (reviewer/admin/custodian), invite-only

Areas affected: `users` collection, `POST /admin/reviewers` (and equivalent for other roles).
Dependencies: F-01…F-04.
Implementation notes: no public signup route exists at all (PRD, Backend Design §3). Admin creates the account; it starts `pending_verification`.
Acceptance criteria: only an authenticated admin can create a staff account; no route accepts an unauthenticated account-creation request.
Tests required: integration test confirming the create-account route 403s without an admin session and doesn't exist without one.
Security / privacy checks: `passwordHash` never returned in any response, ever — assert this in the test, not just by code review.
Observability: `auditLog` entry on every account creation.
Rollback or recovery: deactivate (never hard-delete) a wrongly-created account.
Done evidence: test output + audit log entry sample.
Open questions: none.

### IA-02 / Password + TOTP login, lockout

Areas affected: `POST /auth/login`, `/auth/login/verify`, `users.failedLoginCount`/`lockedUntil`.
Dependencies: IA-01.
Implementation notes: FR-03 — both factors required before any session issues; 3 failed attempts locks the account and writes to `auditLog`.
Acceptance criteria: correct password + wrong TOTP → no session; 3rd consecutive failure locks the account and the lock event is in the audit log.
Tests required: unit tests for the lockout counter; integration test for the full login→verify happy path and the lockout path.
Security / privacy checks: login failure message is generic (doesn't reveal which factor was wrong).
Observability: repeated-auth-failure alert wired here (ties into H-04 later, but the log event itself ships now).
Rollback or recovery: admin-assisted unlock path (no self-service MFA bypass, by design).
Done evidence: test output.
Open questions: none.

### IA-03 / Session issuance and refresh

Areas affected: `POST /auth/refresh`, token signing.
Dependencies: IA-02.
Implementation notes: short-lived access token (15 min) + refresh token (~8h); refresh blocked if `status != active`.
Acceptance criteria: expired access token on any authenticated route redirects client-side to session-expired, not a silent failure; refresh with a deactivated account's token fails.
Tests required: integration tests for expiry and deactivation-blocks-refresh.
Security / privacy checks: tokens are signed, never stored server-side in a way that could be exfiltrated wholesale.
Observability: log token-refresh failures (metadata only).
Rollback or recovery: n/a.
Done evidence: test output.
Open questions: none.

### IA-04 / RBAC middleware and role/tenant boundary enforcement

Areas affected: Express middleware, all `/reviewer/*`, `/admin/*`, `/custodian/*` routes.
Dependencies: IA-02, IA-03.
Implementation notes: role read from the verified token only, never a client-supplied field (Backend Design §4). Route guard checked before any handler logic runs.
Acceptance criteria: a reviewer session hitting any `/admin/*` route gets 403 before touching the DB; URL-guessing a role can't escalate.
Tests required: integration test matrix — each role against each other role's routes, expect 403 across the board.
Security / privacy checks: this task _is_ the security check — see Backend Design §2's cross-user access checklist, each line becomes a test here.
Observability: `unauthorized_access_attempt` audit event on any cross-role hit.
Rollback or recovery: n/a, additive gate.
Done evidence: full role×route test matrix passing.
Open questions: none.

### IA-05 / Reviewer keypair issuance (KMS module)

Areas affected: `reviewerKeys` collection, KMS module (in-process, per TDD §1 — not a separate deployable in V1).
Dependencies: IA-01.
Implementation notes: keypair generated on reviewer account creation; private key encrypted under `KMS_MASTER_KEY` (rotated in F-02) before storage; public key returned to whoever needs to wrap a report key.
Acceptance criteria: creating a reviewer produces a `reviewerKeys` document whose private key field is never returned by any API response, ever.
Tests required: unit test on key generation; integration test asserting no route returns `encryptedPrivateKey` in decrypted form.
Security / privacy checks: this closes S-01's placeholder-wrap gap — see CF-01.
Observability: `key generated` audit-adjacent log (metadata only).
Rollback or recovery: a bad keypair can be revoked (`status: revoked`) and regenerated without deleting the row (preserves any `wrapKeyVersion` references).
Done evidence: test output.
Open questions: none.

### IA-06 / Custodian key setup, structurally isolated

Areas affected: `custodianKeys` collection.
Dependencies: IA-01.
Implementation notes: separate collection and access path from `reviewerKeys` (TDD §7 decision — no shared code path, so a privilege-escalation bug in one can't reach the other). k-of-n shares stored per custodian.
Acceptance criteria: no reviewer- or admin-scoped route or query can reach `custodianKeys`.
Tests required: integration test attempting cross-access from reviewer/admin sessions, expect 403/route-not-found.
Security / privacy checks: this is the FR-08 foundation — verify by code path inspection, not just by test, since the guarantee is structural.
Observability: n/a beyond standard audit trail.
Rollback or recovery: n/a.
Done evidence: test output + a one-paragraph note confirming no shared import path exists between reviewer-key and custodian-key modules.
Open questions: **BLOCKED ON** — who actually holds the custodian role and what k-of-n threshold applies (PRD open question). Ship with a configurable threshold; the organizational decision sets its value, doesn't change the code.

---

## Phase 3 — Core features, dependency order

### CF-01 / Real reviewer-key wrapping replaces S-01's placeholder

Areas affected: `POST /reports`.
Dependencies: S-01, IA-05.
Implementation notes: submission now wraps the report AES key under an actually-assigned or triage-pool reviewer's public key instead of the placeholder from S-01.
Acceptance criteria: a freshly submitted report's `wrappedKey` decrypts correctly with the target reviewer's real private key.
Tests required: integration test: submit → reviewer decrypts → plaintext matches.
Security / privacy checks: confirm the placeholder path from S-01 is fully removed, not left as a fallback.
Observability: none beyond existing submit events.
Rollback or recovery: n/a.
Done evidence: round-trip test output.
Open questions: **open (PRD)** — shared queue vs. explicit admin assignment for unassigned reports; pick one to unblock this task (recommend: land in an unassigned pool, admin assigns — matches Backend Design's `assignedReviewerId: nullable`).

### CF-02 / Optional identity field encryption

Areas affected: `POST /reports`, `reportIdentities` collection.
Dependencies: IA-06.
Implementation notes: ECIES/secp256r1 under the custodian public key, separate from the report body key (PRD Goal 3 — a second, separate key).
Acceptance criteria: a report submitted with identity info produces a `reportIdentities` document only a custodian-gated flow can ever decrypt.
Tests required: unit test on the encryption call; integration test confirming no reviewer/admin route returns this field's plaintext.
Security / privacy checks: same collection-separation guarantee as IA-06.
Observability: none report-content-bearing.
Rollback or recovery: n/a.
Done evidence: test output.
Open questions: none.

### CF-03 / Reviewer dashboard, assigned-only

Areas affected: `/reviewer` route, `GET` list endpoint.
Dependencies: IA-04, CF-01.
Implementation notes: `assignedReviewerId: session.userId` is part of the DB query itself, not a post-fetch filter (Backend Design §4).
Acceptance criteria: a reviewer never sees another reviewer's report id anywhere in the response, including counts.
Tests required: integration test with two reviewers, cross-check each only sees their own.
Security / privacy checks: covered by the test above — this is the FR-04 guarantee.
Observability: `dashboard_viewed` event.
Rollback or recovery: n/a.
Done evidence: test output.
Open questions: none.

### CF-04 / Report detail — decrypt, integrity check, access denial

Areas affected: `GET /reports/:id`, Report Detail screen.
Dependencies: CF-03.
Implementation notes: server recomputes HMAC and returns `integrityOk`; a mismatch withholds content and returns 409, not a rendered body. Non-assigned access returns 403 _before_ any ciphertext leaves the DB layer (query-level filter, same pattern as CF-03).
Acceptance criteria: HMAC mismatch shows "Integrity check failed", not content; non-assigned reviewer hitting the URL directly gets 403 and the attempt is audit-logged.
Tests required: integration tests for both failure paths; e2e test for the decrypt-and-display happy path.
Security / privacy checks: confirm the 403 path never transmits ciphertext (assert on response body, not just status code).
Observability: alert on any `integrityOk: false` occurrence — target is zero, per PRD success signals.
Rollback or recovery: n/a, read path.
Done evidence: test output + alert config screenshot.
Open questions: none.

### CF-05 / Status updates, hash-chained log

Areas affected: `PATCH /reports/:id/status`, `statusLog`.
Dependencies: CF-04.
Implementation notes: valid-transition check (no backward skips), signed chained entry appended, idempotent on same-status retry (Backend Design §5).
Acceptance criteria: an invalid transition is rejected with 400; re-submitting the same status twice appends one entry, not two; a direct DB edit of a log entry fails chain verification on next read.
Tests required: unit tests for transition rules and idempotency; integration test simulating a tampered entry and confirming detection.
Security / privacy checks: no session → 400/401, not silently accepted.
Observability: alert on any chain-verification failure (zero-tolerance, per PRD).
Rollback or recovery: n/a — by design there's no update/delete path for log entries to roll back.
Done evidence: test output.
Open questions: none.

### CF-06 / Status history view with chain verification surfaced

Areas affected: `GET /reports/:id/history`.
Dependencies: CF-05.
Implementation notes: response includes the chain-verification result inline, not just raw entries.
Acceptance criteria: a verified chain shows as verified; a tampered one (from CF-05's test fixture) shows as failed in the same response shape.
Tests required: integration test reusing CF-05's tamper fixture.
Security / privacy checks: admin gets metadata-only view of this same data (no content field exists here regardless of role).
Observability: n/a beyond CF-05's alert.
Rollback or recovery: n/a.
Done evidence: test output.
Open questions: none.

### CF-07 / Read receipts

Areas affected: `readReceipts` collection, write-on-open.
Dependencies: CF-04.
Implementation notes: one line, write `{reportId, reviewerId, openedAt}` on report open. No UI is specified for surfacing this yet beyond what's already in Report Detail — skip building a display for it until a screen asks for one (YAGNI; the schema and write path are all this task needs).
Acceptance criteria: opening a report writes exactly one receipt per open.
Tests required: unit test on the write.
Security / privacy checks: none beyond standard RBAC.
Observability: n/a.
Rollback or recovery: n/a.
Done evidence: test output.
Open questions: none.

### CF-08 / Admin reviewer management, content-blind by construction

Areas affected: `/admin/reviewers`, `/admin/reviewers/:id`, admin query layer.
Dependencies: IA-04.
Implementation notes: separate query/response path that never selects content fields — not a shared query with fields stripped after (TDD §7 decision, re-verified here at the implementation level).
Acceptance criteria: no admin API response, under any input, ever contains `ciphertextBody`, `nonce`, `authTag`, `wrappedKey`, or identity ciphertext fields.
Tests required: integration test that tries to coerce content out via query params/broad requests and asserts the field is structurally absent, not just falsy.
Security / privacy checks: this is FR-06's core guarantee — test it adversarially, not just the happy path.
Observability: any admin route returning a content field is treated as an incident-level bug, not a warning.
Rollback or recovery: n/a.
Done evidence: adversarial test output.
Open questions: none.

### CF-09 / Key rotation, async and idempotent

Areas affected: `POST /admin/reviewers/:id/rotate-key`, KMS module.
Dependencies: IA-05, CF-08.
Implementation notes: re-wraps all of that reviewer's report keys under a new keypair, destroys the old private key, async with progress state for reviewers with many reports; re-triggering mid-rotation resumes rather than double-wraps (Backend Design §5).
Acceptance criteria: after rotation, all previously-assigned reports decrypt under the new key only; the old key can no longer decrypt anything; a second trigger during an in-flight rotation doesn't corrupt state.
Tests required: integration test with a reviewer holding several reports, full rotation + re-trigger-mid-rotation case.
Security / privacy checks: old private key is actually destroyed, not just marked `rotated` — assert this, not just the status field.
Observability: rotation progress + completion logged.
Rollback or recovery: "rotation incomplete" state with a safe retry, per App Flow §3.
Done evidence: test output.
Open questions: none.

### CF-10 / Audit log write path + admin read

Areas affected: `auditLog` collection, `GET /admin/audit-log`.
Dependencies: IA-04.
Implementation notes: every sensitive action across prior tasks (IA-01, IA-02 lockout, IA-04 unauthorized attempts, CF-04 access denial, CF-05 status change, CF-09 rotation) already writes here — this task is the read endpoint and confirming write coverage, not a new write path per action.
Acceptance criteria: filtering by date range/actor/action type returns the expected subset; the collection has no field capable of holding content (schema-level, per Backend Design §1).
Tests required: integration test on filters; schema test asserting no content-shaped field exists.
Security / privacy checks: admin-only, 403 otherwise.
Observability: this endpoint _is_ the observability surface for admins.
Rollback or recovery: n/a, append-only.
Done evidence: test output.
Open questions: none.

### CF-11 / Identity reveal governance (FR-08)

Areas affected: `POST /reports/:id/reveal-identity`, `revealRequests`, `POST /custodian/reveal-requests/:id/decision`, Custodian Queue, Reveal Approval screens.
Dependencies: CF-02, IA-06, CF-10.
Implementation notes: reviewer/admin creates a pending request; custodian(s) vote, idempotent per custodian (a repeat vote returns the existing decision, doesn't double-count); threshold met → transient decrypt delivered to the original requester only, never persisted in plaintext; threshold not met or denied → closed, no data returned. Every outcome (approved, denied, attempted-without-authorization) is a signed chained `statusLog` entry — same tamper-evidence as FR-05, not a separate weaker mechanism.
Acceptance criteria: identity plaintext is returned only after the exact configured threshold; a reviewer/admin hitting the decrypt path directly (bypassing custodian approval) gets 403 and that attempt is logged as a notable audit event; every request outcome has a corresponding statusLog entry, no exceptions.
Tests required: e2e test covering request → partial approval (still pending) → threshold met → delivery; integration tests for denial and for the direct-bypass-attempt 403; test asserting statusLog coverage for all three outcomes.
Security / privacy checks: this is the highest-stakes single feature in the system — pair-review the diff, and re-run CF-11's tests as part of H-01 (hardening) as well as here.
Observability: reveal attempts (any outcome) alerted, not just logged silently — this should be rare enough that a human notices each one.
Rollback or recovery: a denied request has no override path by design (App Flow §3) — this is intentional, not a gap to "fix" later.
Done evidence: e2e recording + statusLog coverage test output.
Open questions: **BLOCKED ON** the same custodian-identity/threshold decision as IA-06.

---

## Phase 4 — External integrations

Only one third party exists in V1 (Backend Design §8): SMTP, for account-lifecycle email only. No payment processor, no external IdP, no file storage — building sandboxes for integrations that don't exist would be waste, so this phase stays this small on purpose.

### EI-01 / SMTP relay, account-lifecycle email only

Areas affected: invite email, password-reset email, lockout notice.
Dependencies: IA-01, IA-02.
Implementation notes: use a sandbox/test SMTP provider in dev and staging (e.g. Mailhog locally, provider's sandbox mode in staging) before touching a real relay in production. The email-sending code path has no import of, or access to, any report-content module — enforced by construction (separate module with no dependency on `reports`), not by convention (Backend Design §8).
Acceptance criteria: an invite/reset/lockout email sends and is inspectable in the sandbox inbox; a code-level check (e.g. a dependency-graph lint rule or simple import test) confirms the email module can't reach report data.
Tests required: integration test for each of the three email triggers; a static check that the mailer module has zero imports from the reports/reportIdentities modules.
Security / privacy checks: email content is reviewed to confirm it never includes a tracking ID, report status, or any report-derived value.
Observability: log send success/failure (metadata — recipient hash or user id, not raw address, in logs).
Rollback or recovery: if the relay fails, the triggering action (invite/reset/lockout) still completes — email is fire-and-forget with a retry queue, not a blocking dependency for account state changes.
Done evidence: sandbox inbox screenshots + import-check test output.
Open questions: none.

### EI-02 / Password reset flow

Areas affected: `POST /auth/reset-request`, `/auth/reset` (or equivalent), one-time token.
Dependencies: EI-01.
Implementation notes: emailed one-time link, ~1h expiry, invalidated after single use.
Acceptance criteria: a used or expired reset token is rejected; a fresh one succeeds exactly once.
Tests required: integration tests for expiry, reuse, and happy path.
Security / privacy checks: reset doesn't leak whether an email address has an account (generic response either way).
Observability: reset attempts logged (metadata only).
Rollback or recovery: n/a.
Done evidence: test output.
Open questions: none.

---

## Phase 5 — UI completion

### UI-01 / Design tokens and shared theme

Areas affected: `/client` theme/CSS layer.
Dependencies: F-01.
Implementation notes: implement the Design Brief's token tables directly (colour roles, IBM Plex Sans/Mono, 4/8/12/16/24/32/48/64 spacing scale, 4px/8px radius) as CSS custom properties or a Tailwind theme config — one source of truth, not per-component magic values.
Acceptance criteria: no component hardcodes a colour, spacing, or radius value outside the token set (lint rule or code review checklist).
Tests required: visual regression snapshot on a few key screens (optional but cheap given a token system — add if the team already has snapshot tooling, skip building new tooling just for this).
Security / privacy checks: none.
Observability: none.
Rollback or recovery: n/a.
Done evidence: token file + a couple of screens using it.
Open questions: none.

### UI-02 / Responsive layouts

Areas affected: Reviewer Dashboard, Custodian Queue, and any table-based screen.
Dependencies: UI-01, CF-03, CF-11.
Implementation notes: table on desktop, stacked cards on mobile — same data, per Design Brief; breakpoints at 640/1024px.
Acceptance criteria: no horizontal scroll on any screen at any breakpoint in the 3 defined ranges.
Tests required: responsive e2e checks at 375px/768px/1280px viewport widths for the affected screens.
Security / privacy checks: none.
Observability: none.
Rollback or recovery: n/a.
Done evidence: viewport screenshots at each breakpoint.
Open questions: none.

### UI-03 / Full state coverage per screen

Areas affected: every screen in App Flow's Screen Inventory.
Dependencies: all Phase 3 tasks whose screens this depends on.
Implementation notes: loading skeletons matching eventual content shape (not generic spinners), empty states as plain neutral text, persistent banners (not auto-dismiss toasts) for security-relevant errors — per Design Brief's Loading/Empty/Error rules. Work through the Screen Inventory table as a checklist; don't invent states the inventory doesn't call for.
Acceptance criteria: each screen in the inventory has its loading, empty (where applicable), and error states implemented and visually distinct from each other.
Tests required: e2e tests forcing each state (mock slow network for loading, empty DB for empty, forced 500 for error) per screen.
Security / privacy checks: confirm integrity-check-failed and reveal-denied states use the persistent-banner pattern, never a toast (Design Brief explicitly calls this out).
Observability: none beyond existing event logging.
Rollback or recovery: n/a.
Done evidence: test output + one screenshot per state per screen.
Open questions: none.

### UI-04 / Accessibility pass

Areas affected: all screens.
Dependencies: UI-01, UI-02, UI-03.
Implementation notes: focus ring using the dedicated `focus` token (never `outline: none` unreplaced), full keyboard tab order, skip-to-content link on authenticated layouts, `prefers-reduced-motion` respected, 44×44px minimum touch targets, WCAG AA body text / AAA on danger-state text.
Acceptance criteria: automated axe-core scan passes with zero critical/serious violations; manual keyboard-only pass completes every primary journey without a mouse.
Tests required: axe-core CI check added to the pipeline; manual keyboard-only walkthrough recorded once per role.
Security / privacy checks: none.
Observability: axe results become part of CI output going forward (not a one-time pass).
Rollback or recovery: n/a.
Done evidence: axe report + keyboard-walkthrough recording.
Open questions: none.

### UI-05 / Remaining static/system screens

Areas affected: Home, 403, 404, Session Expired.
Dependencies: UI-01.
Implementation notes: thin, mostly-static pages; 403/404 stay generic per App Flow's Permission Failure Summary — no per-cause detail leaked in copy.
Acceptance criteria: each renders correctly and matches the "generic, no hint" wording requirement for 403/404.
Tests required: e2e smoke test hitting each route directly.
Security / privacy checks: confirm 403/404 copy doesn't vary by cause (grep for any conditional text).
Observability: none.
Rollback or recovery: n/a.
Done evidence: test output.
Open questions: none.

---

## Phase 6 — Hardening

### H-01 / Threat review against the TDD's own threat list

Areas affected: whole system.
Dependencies: all of Phase 3.
Implementation notes: this isn't a fresh threat model — TDD §5 and Backend Design §2's "SECURITY CHECK" list already name the threats (compromised reviewer, rogue admin, DB breach, tampering, MITM, tracking-ID enumeration, cross-role access). This task is re-running each one as an adversarial test against the _actual_ running system, not re-deriving them.
Acceptance criteria: every item in Backend Design §2's SECURITY CHECK list and TDD §5's threat list has a corresponding passing adversarial test, not just a design-doc claim.
Tests required: the adversarial test suite itself is the deliverable — one test per named threat.
Security / privacy checks: this task is entirely security checks.
Observability: any failure here blocks release (R-05 gate).
Rollback or recovery: n/a.
Done evidence: full adversarial test suite output.
Open questions: none.

### H-02 / Rate limiting

Areas affected: `POST /reports`, `GET /reports/track/:id`, `POST /auth/login`.
Dependencies: F-04.
Implementation notes: per-IP limits on the three unauthenticated/high-abuse-risk endpoints (already called out per-endpoint in TDD §4 and Backend Design §5) — an existing well-tested middleware (`express-rate-limit`) covers this; no reason to hand-roll one.
Acceptance criteria: exceeding the limit returns 429, not a silent drop or a 500.
Tests required: integration test driving past the limit and asserting 429.
Security / privacy checks: limit is per-IP, not per-account (reporters have no account to key off of).
Observability: 429 rate logged for abuse-pattern visibility.
Rollback or recovery: limit values are config, adjustable without a redeploy if too aggressive.
Done evidence: test output.
Open questions: none.

### H-03 / Backup and retention configuration

Areas affected: Atlas snapshot config.
Dependencies: none (infra-only).
Implementation notes: confirm Atlas automated snapshots are actually enabled (not just assumed because the `.env` implies Atlas is in use) and set a retention window.
Acceptance criteria: a snapshot exists and is restorable in staging as a drill.
Tests required: one manual restore-to-staging drill, documented.
Security / privacy checks: restored data in staging must still be synthetic-only per TDD §6 — never restore a prod snapshot into staging as a shortcut.
Observability: snapshot success/failure alerting via Atlas's own tooling.
Rollback or recovery: this task _is_ the recovery mechanism for everything else.
Done evidence: drill report.
Open questions: **BLOCKED ON** the retention-policy decision (PRD open question) — ship the mechanism now with a provisional "no automatic deletion" default (Backend Design §7), revisit the number once legal/compliance decides.

### H-04 / Alerting wired to a real channel

Areas affected: log aggregator config.
Dependencies: F-04, CF-05 (chain-verification events), CF-04 (integrity events), IA-02 (auth failures).
Implementation notes: the log events already exist from earlier tasks; this task is routing HMAC/chain-verification failures and repeated-auth-failure patterns to something a human actually sees (email/Slack/pager), closing the loop TDD §6 describes.
Acceptance criteria: a forced integrity failure in staging triggers a real alert within an agreed SLA (e.g. under 5 minutes).
Tests required: one forced-failure drill per alert type.
Security / privacy checks: alert payload contains metadata only, same rule as logs.
Observability: this task is the observability closer.
Rollback or recovery: n/a.
Done evidence: drill screenshots/timestamps.
Open questions: none.

### H-05 / Secrets and storage hardening review

Areas affected: whole system's secret handling.
Dependencies: F-02.
Implementation notes: confirm no secret introduced since F-02 has leaked into logs, error responses, or source control (`git log -p` scan, error-envelope review per Backend Design §5's "never a raw stack trace or DB error string" rule); confirm `KMS_MASTER_KEY` rotation from F-02 didn't silently break any `reviewerKeys`/`custodianKeys` decryption path.
Acceptance criteria: automated secret-scan (e.g. `gitleaks`) on the full repo history returns clean; error responses never include a stack trace or raw DB error, checked adversarially.
Tests required: gitleaks CI job; integration test forcing a DB error and asserting the response envelope is generic.
Security / privacy checks: this task is entirely security checks.
Observability: gitleaks becomes a permanent CI gate, not a one-time run.
Rollback or recovery: n/a.
Done evidence: gitleaks report + generic-error test output.
Open questions: none.

---

## Phase 7 — Release

### R-01 / Production config finalized

Areas affected: prod environment.
Dependencies: F-02, H-05, hosting decision.
Implementation notes: dev/staging/prod each carry separate `KMS_MASTER_KEY` and `MONGODB_URI` per TDD §6; staging seeded with synthetic data only, never scrubbed prod data.
Acceptance criteria: prod and staging demonstrably can't read each other's data (different DB, different key — verify, don't assume).
Tests required: connection-string diff check + a synthetic-vs-real data audit of staging.
Security / privacy checks: covered above.
Observability: n/a.
Rollback or recovery: n/a, config-only.
Done evidence: config diff + staging data audit note.
Open questions: **BLOCKED ON** the hosting decision (TDD §7 — "Proposed," not yet finalized between managed platform vs. self-managed containers) and any data-residency requirement that decision depends on.

### R-02 / Migrations and indexes

Areas affected: all collections listed in Backend Design §6.
Dependencies: R-01.
Implementation notes: create every index from Backend Design §6's table (`trackingId` unique, `assignedReviewerId`, `status`, compound `statusLog`/`revealRequests` indexes, etc.) as an idempotent migration script; bootstrap the first admin account manually (out-of-band, not via a public route — there isn't one).
Acceptance criteria: `EXPLAIN` on the high-frequency queries (trackingId lookup, assigned-reports list) shows index usage, not a collection scan.
Tests required: migration script runs cleanly against an empty DB and a re-run is a no-op.
Security / privacy checks: first-admin bootstrap credential is set via a one-time secret, not a hardcoded default.
Observability: n/a.
Rollback or recovery: migration script has a documented down-path for index removal if one causes an unexpected write-performance regression.
Done evidence: EXPLAIN output + migration re-run log.
Open questions: none.

### R-03 / Monitoring dashboards

Areas affected: log aggregator / APM dashboard.
Dependencies: H-04.
Implementation notes: surface the PRD's actual success signals (submission completion rate, tracking-ID lookup success rate, time-to-first-status-update, integrity-check-failure count, admin content-exposure incidents) as dashboard panels — these are already named in the PRD, this task wires them up rather than inventing new metrics.
Acceptance criteria: each PRD success signal has a live panel with real data flowing.
Tests required: n/a — verify visually against known test traffic.
Security / privacy checks: dashboard shows counts/rates only, never a tracking ID or content field (App Flow analytics rule extended here).
Observability: this task is the observability deliverable.
Rollback or recovery: n/a.
Done evidence: dashboard screenshot.
Open questions: none.

### R-04 / Rollback plan, KMS-aware

Areas affected: deploy pipeline.
Dependencies: R-01, CF-09.
Implementation notes: a normal deploy rolls back like any stateless API redeploy; a deploy that touches the KMS module (key generation, wrapping, rotation logic) is flagged as higher-stakes per TDD §2 — document and rehearse the specific rollback for that case (e.g. don't roll back mid-rotation; let an in-flight rotation either complete or resume via CF-09's idempotency rather than reverting code underneath it).
Acceptance criteria: a rehearsed rollback of a non-KMS deploy completes in under an agreed time; the KMS-specific rollback procedure is written down and has been walked through once (not just theorized).
Tests required: one rollback drill, one KMS-deploy rollback drill.
Security / privacy checks: rollback never re-exposes an already-rotated/destroyed private key.
Observability: deploy/rollback events logged.
Rollback or recovery: this task's output _is_ the rollback plan.
Done evidence: two drill reports.
Open questions: none.

### R-05 / Go/no-go smoke test

Areas affected: production, post-deploy.
Dependencies: everything above.
Implementation notes: re-run S-01's thin-slice journey against production as the final gate — if a reporter still can't submit and track a report end-to-end in prod, nothing else matters.
Acceptance criteria: the S-01 journey passes in production before traffic is considered fully cut over; H-01's adversarial suite also re-run against prod config (not just staging) as part of this gate.
Tests required: S-01's e2e suite + H-01's adversarial suite, both pointed at prod.
Security / privacy checks: covered by H-01 re-run.
Observability: this smoke test's pass/fail is itself logged as a deploy-gate event.
Rollback or recovery: failure here triggers R-04's rollback plan immediately.
Done evidence: prod-pointed test run output.
Open questions: none.

---

## Cross-cutting open questions carried from earlier docs (not resolved by this plan, but each is pinned to the task it blocks)

| Open question                                                    | Blocks                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retention policy for resolved reports / statusLog / auditLog     | H-03 (retention window)                                                                                                                                                                  |
| Who holds the identity-custodian role, and what k-of-n threshold | IA-06, CF-11                                                                                                                                                                             |
| Managed platform vs. self-managed hosting, and data residency    | R-01, and indirectly F-02's per-environment secret storage location                                                                                                                      |
| Shared reviewer queue vs. explicit admin assignment              | CF-01 (recommended default given above: unassigned pool + admin assignment, matches the existing nullable `assignedReviewerId` field — revisit only if the organization wants otherwise) |

None of these block starting the plan — they block specific tasks late enough in the sequence (Phase 2 onward) that there's real time to get an organizational answer before the task is due.

---

> **Reality check (added during memory review, 2026-09-02):** this plan assumes the TDD's WebCrypto/library-based crypto and RSA-4096. The actual repo constrains all of `server/src/crypto/` to hand-rolled `BigInt` RSA/ECC/hashing (README.md), with encryption currently happening server-side rather than client-side (see root `CLAUDE.md`). Every task above that says "client-side WebCrypto" (S-01, CF-01, CF-02) needs its crypto calls swapped for the from-scratch `server/src/crypto/*` modules, and — if the server-side-encryption pattern already in `reportController.js`'s TODOs is kept — S-01/CF-01/CF-02's "client encrypts, server never sees plaintext" acceptance criteria need to be renegotiated, not silently reinterpreted. Task sequencing, acceptance criteria, and security checks otherwise stand as written.
