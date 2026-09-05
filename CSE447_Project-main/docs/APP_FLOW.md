# App Flow & State Map — Whistleblower / Anonymous Reporting Tool

Document 03/06. Companion to the PRD (01/06) and TDD (02/06).

---

## 1. Screen Inventory

| Screen                  | Route                           | Purpose                                                                | Allowed roles                                   |
| ----------------------- | ------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| Home / Landing          | `/`                             | Entry point — explains the tool, links to Submit and Track             | Public                                          |
| Submit Report           | `/submit`                       | Report submission form                                                 | Public (no account)                             |
| Submission Confirmation | `/submit/confirmation`          | Show tracking ID once, warn it won't be shown again                    | Public                                          |
| Track Status            | `/track`                        | Enter a tracking ID                                                    | Public                                          |
| Track Status Result     | `/track/:trackingId`            | Show current status for that ID                                        | Public                                          |
| Login                   | `/login`                        | Credential entry                                                       | Reviewer, Admin, Custodian                      |
| 2FA Verify              | `/login/verify`                 | TOTP challenge                                                         | Reviewer, Admin, Custodian                      |
| Reviewer Dashboard      | `/reviewer`                     | List of reports assigned to this reviewer                              | Reviewer                                        |
| Report Detail           | `/reviewer/reports/:id`         | Decrypt and read a report, update status                               | Reviewer (assigned only)                        |
| Report History          | `/reviewer/reports/:id/history` | View the hash-chained status log                                       | Reviewer (assigned), Admin (metadata view only) |
| Admin Dashboard         | `/admin`                        | Overview: reviewer count, open reports (metadata), recent audit events | Admin                                           |
| Reviewer Management     | `/admin/reviewers`              | List/create/deactivate reviewer accounts                               | Admin                                           |
| Reviewer Detail         | `/admin/reviewers/:id`          | Trigger key rotation, deactivate                                       | Admin                                           |
| Audit Log               | `/admin/audit-log`              | Metadata-only activity log                                             | Admin                                           |
| Custodian Queue         | `/custodian`                    | Pending identity-reveal requests                                       | Custodian                                       |
| Reveal Approval         | `/custodian/requests/:id`       | Approve/deny a specific reveal request                                 | Custodian                                       |
| Forbidden               | `/403`                          | Shown on any permission failure                                        | All (system route)                              |
| Not Found               | `/404`                          | Shown on bad/expired routes and IDs                                    | All (system route)                              |
| Session Expired         | `/session-expired`              | Shown when an authenticated session times out                          | Reviewer, Admin, Custodian                      |

## 2. Navigation Rules

**Desktop:**

- Public area (Home/Submit/Track) uses a simple top nav with two links: "Submit a report" and "Track a report." No login link is prominent here — deliberately, since most visitors are reporters, not staff.
- A small, low-emphasis "Staff login" link sits in the footer, not the header — it shouldn't compete visually with the reporter-facing actions.
- Authenticated areas (Reviewer/Admin/Custodian) use a persistent left sidebar scoped to that role's screens only — a reviewer never sees admin nav items rendered-then-hidden; they simply don't exist in that role's nav tree.

**Mobile:**

- Public area: same two primary actions as large tappable buttons on the home screen rather than a nav bar; "Staff login" collapses into a hamburger/overflow menu.
- Authenticated areas: sidebar collapses to a bottom tab bar (Dashboard / Reports / Log-out) for Reviewer and Admin; Custodian's smaller surface (just the queue) uses a single-screen layout with no tab bar needed.
- All forms (Submit Report especially) are single-column, with the optional identity field visually de-emphasized/collapsed by default so it reads as clearly optional.

## 3. Primary Journeys

### JOURNEY: Reporter submits a report (first-value action)

1. Entry point: Home (`/`) → taps/clicks "Submit a report."
2. User action: fills title, description, category; optionally expands and fills identity field; submits.
3. System response: client encrypts body (and identity, if present) locally, POSTs ciphertext, receives a tracking ID.
4. Decision or branch: if any required field is missing → inline validation, no submission attempt. If network/server error → error state with retry, form contents preserved.
5. Completion state: Submission Confirmation (`/submit/confirmation`) shows the tracking ID with a clear, one-time warning to save it.

**Recovery path:** none by design — if the reporter loses the tracking ID, there is no account-based recovery (this is an intentional tradeoff per PRD; the confirmation screen's copy exists specifically to reduce how often this happens).

**Permission edge case:** N/A — this journey has no auth.

**Testable success condition:** a report submitted with valid required fields results in a `reports` document created, a tracking ID returned and displayed, and the reporter is able to immediately look that ID up on the Track screen and see status "Submitted."

---

### JOURNEY: Reporter checks status (returning user)

1. Entry point: Home → "Track a report," or a bookmarked `/track` link.
2. User action: enters tracking ID, submits.
3. System response: server looks up by ID, returns status enum only.
4. Decision or branch: valid ID → status shown. Invalid/expired ID → generic "not found," identical wording regardless of _why_ it wasn't found (PRD FR-02).
5. Completion state: Track Status Result screen showing current status (Submitted / Under Review / Resolved).

**Recovery path:** re-enter ID if mistyped; no other recovery (see above journey).

**Permission edge case:** N/A — no auth on this path by design.

**Testable success condition:** entering a valid tracking ID always returns the current true status; entering any invalid string returns the same generic not-found response, with no timing or content difference that could leak whether an ID is "close" to valid.

---

### JOURNEY: Reviewer logs in and processes an assigned report (core sensitive-action journey)

1. Entry point: `/login`.
2. User action: enters credentials, then TOTP code at `/login/verify`.
3. System response: on success, session issued (15-min access token), redirected to Reviewer Dashboard; dashboard lists only reports where `assignedReviewerId` matches this reviewer.
4. Decision or branch: reviewer opens a report → client fetches ciphertext + wrapped key, decrypts locally, server recomputes HMAC server-side and returns an integrity flag alongside the ciphertext. If HMAC mismatch → Report Detail shows "Integrity check failed" instead of content, and the report is not rendered. If reviewer attempts to open a report not assigned to them (e.g. via a guessed URL) → redirected to `/403`.
5. Completion state: reviewer reads the report, optionally updates status (PATCH), which appends a new signed statusLog entry and returns to Report Detail showing the updated status and updated history.

**Recovery path:** a failed 2FA attempt allows retry up to the lockout threshold (PRD FR-03); a decryption failure on the client (e.g. corrupted wrapped key) surfaces a distinct "couldn't decrypt — contact admin for key status" error, separate from the integrity-check-failed state, since these indicate different problems.

**Permission edge case:** direct navigation to another reviewer's report URL → `/403`, and the attempt is written to the audit log (metadata: actor, target report ID, timestamp — not content).

**Testable success condition:** a reviewer can reach, decrypt, and read only reports where they are `assignedReviewerId`; any other report ID returns 403 before any ciphertext is even transmitted to the client.

---

### JOURNEY: Admin manages reviewers and rotates a key

1. Entry point: `/admin` → Reviewer Management.
2. User action: creates a new reviewer account, or selects an existing one and triggers key rotation.
3. System response: on create, a new `users` + `reviewerKeys` document pair is generated (private key never returned to admin's client); on rotation, KMS re-wraps all of that reviewer's report keys under the new public key and marks the old key `rotated`.
4. Decision or branch: if rotation is triggered on a reviewer with zero assigned reports, it completes trivially; if the reviewer has many assigned reports, rotation is asynchronous with a visible progress/pending state rather than blocking the admin UI.
5. Completion state: Reviewer Detail shows updated key version and "active since" timestamp; event recorded in Audit Log.

**Recovery path:** if rotation fails partway (e.g. server restart mid-batch), the admin sees a "rotation incomplete" state with a retry action; the system must be idempotent here — retrying should re-wrap only keys not yet migrated, not double-wrap.

**Permission edge case:** a non-admin attempting any `/admin/*` route → redirected to `/403`; a reviewer's own session token can never authorize an admin route regardless of URL guessing.

**Testable success condition:** after rotation, all of that reviewer's previously accessible reports remain decryptable using only the new private key, and the old private key (once destroyed per TDD) can no longer decrypt anything.

---

### JOURNEY: Custodian approves an identity reveal (PRD FR-08)

1. Entry point: a reviewer or admin initiates a reveal request from Report Detail (visible only if `reportIdentities` exists for that report); this creates a pending request and notifies custodian(s).
2. User action: custodian logs in (own 2FA), opens Custodian Queue, reviews the request context (which report, who requested, stated reason if collected), approves or denies.
3. System response: if k-of-n threshold requires multiple approvals, the request stays "pending" showing count so far until met; if denied by any required custodian (depending on governance rule chosen), it's rejected outright.
4. Decision or branch: threshold met → identity decrypted and made available to the requester through an audited view; threshold not met or explicitly denied → request closed as denied, requester notified with no identity data.
5. Completion state: either outcome is written to `statusLog` as a signed, chained entry (PRD FR-08) — this is not optional, it happens regardless of approve/deny.

**Recovery path:** a requester whose request was denied can submit a new request with updated justification; there's no "override" path by design — that would defeat the governance point of the feature.

**Permission edge case:** a reviewer or admin attempting to hit the reveal-decrypt endpoint directly (bypassing the custodian flow) → 403, and this attempt itself is logged as a notable audit event given its sensitivity.

**Testable success condition:** identity plaintext is only ever returned by the API after the exact configured threshold of custodian approvals is recorded, and every request (approved, denied, or attempted-without-authorization) has a corresponding statusLog entry.

---

## 4. Screen Details

**SCREEN: Submit Report**
ROUTE: `/submit`
Purpose: Let a reporter file a new report without an account.
Allowed roles: Public.
Entry conditions: None.
Data required: title, description, category (required); identity info (optional, collapsed by default).
Primary / secondary actions: Submit (primary); Cancel/clear form (secondary).
Success outcome / next screen: → Submission Confirmation, tracking ID displayed.
Loading / empty states: submit button shows a spinner and disables during the encrypt+send step; form is empty by default with placeholder guidance text per field.
Validation / system errors: inline field-level validation for required fields before submit is attempted; a network/server error shows a banner with "Try again" and preserves all entered text (encryption is redone client-side on retry, nothing sensitive is lost).
Mobile behaviour: single-column, identity field behind a "Add identifying info (optional)" expandable section to keep the default view short and clearly anonymous-first.
Analytics events: `report_submit_started`, `report_submit_succeeded`, `report_submit_failed` (event only, no field values logged).

**SCREEN: Submission Confirmation**
ROUTE: `/submit/confirmation`
Purpose: Show the tracking ID exactly once and make its importance unmistakable.
Allowed roles: Public.
Entry conditions: Only reachable immediately after a successful submission (not bookmarkable/re-visitable with meaning — refreshing loses the ID from view, by design, since it shouldn't linger in browser history in a re-displayable way).
Data required: tracking ID (held in transient client state from the submission response, not re-fetchable).
Primary / secondary actions: Copy tracking ID (primary); "I've saved it, go to Track page" (secondary).
Success outcome / next screen: reporter navigates away once they've saved the ID.
Loading / empty states: N/A — data is already in hand from the prior request.
Validation / system errors: N/A.
Mobile behaviour: large, easily-tappable copy button; explicit warning text sized prominently, not a small-print disclaimer.
Analytics events: `tracking_id_copied`.

**SCREEN: Track Status Result**
ROUTE: `/track/:trackingId`
Purpose: Show current status for a given tracking ID.
Allowed roles: Public.
Entry conditions: Reached via the Track Status form submit, or a direct URL (supported, since some reporters may save the URL itself instead of just the ID).
Data required: tracking ID from the route param.
Primary / secondary actions: "Check another ID" (secondary, returns to `/track`).
Success outcome / next screen: status displayed (Submitted / Under Review / Resolved); no further navigation implied.
Loading / empty states: loading spinner while lookup is in flight, with a timeout (~10s) that falls back to an error state with retry.
Validation / system errors: invalid/expired ID → generic "not found" message, same wording and response time profile as any other invalid ID to avoid leaking information.
Mobile behaviour: same as desktop, single centered status card.
Analytics events: `status_check_performed` (success/not-found outcome only, never the ID value itself).

**SCREEN: Reviewer Dashboard**
ROUTE: `/reviewer`
Purpose: Reviewer's list of currently assigned reports.
Allowed roles: Reviewer.
Entry conditions: Valid authenticated session.
Data required: reports where `assignedReviewerId` = current reviewer.
Primary / secondary actions: Open a report (primary, per row); filter by status (secondary).
Success outcome / next screen: → Report Detail.
Loading / empty states: skeleton list while loading; empty state "No reports currently assigned to you" if the list is genuinely empty — distinct from a loading or error state.
Validation / system errors: session-expired mid-session → redirected to `/session-expired`, not a silent failure.
Mobile behaviour: list collapses to stacked cards instead of a table.
Analytics events: `dashboard_viewed`.

**SCREEN: Report Detail**
ROUTE: `/reviewer/reports/:id`
Purpose: Decrypt and display a single assigned report; allow status updates.
Allowed roles: Reviewer (must be `assignedReviewerId`).
Entry conditions: Valid session + assignment match, checked server-side before any ciphertext is returned.
Data required: report ciphertext, wrapped key, current status, history summary.
Primary / secondary actions: Update status (primary); view full history (secondary); request identity reveal, if applicable (secondary, sensitive).
Success outcome / next screen: status update reflects immediately in place; no forced navigation away.
Loading / empty states: loading spinner while ciphertext is fetched and client-side decryption runs.
Validation / system errors: HMAC mismatch → "Integrity check failed" state, content withheld, admin notified via audit log; not-assigned access attempt → `/403` before this screen ever renders content.
Mobile behaviour: status-update control and history link move into a sticky bottom action bar to stay reachable while scrolling a long report body.
Analytics events: `report_opened`, `report_status_updated`, `identity_reveal_requested`.

**SCREEN: Admin Dashboard**
ROUTE: `/admin`
Purpose: Admin's overview — counts and recent activity, metadata only.
Allowed roles: Admin.
Entry conditions: Valid authenticated session.
Data required: reviewer count, open-report count (metadata), recent audit-log entries.
Primary / secondary actions: Navigate to Reviewer Management or Audit Log (both secondary from here — this screen is a summary, not an action hub).
Success outcome / next screen: N/A, landing screen.
Loading / empty states: skeleton widgets while counts load.
Validation / system errors: any attempt by this screen's API calls to return content-bearing fields is a server-side bug, not a state this screen needs to handle — the response schema structurally excludes them (TDD §7).
Mobile behaviour: summary cards stack vertically.
Analytics events: `admin_dashboard_viewed`.

**SCREEN: Custodian Queue**
ROUTE: `/custodian`
Purpose: List pending identity-reveal requests awaiting this custodian's decision.
Allowed roles: Custodian.
Entry conditions: Valid authenticated session, custodian role.
Data required: pending requests with report ID (not content), requester, timestamp, current approval count vs. threshold.
Primary / secondary actions: Open a request to approve/deny (primary).
Success outcome / next screen: → Reveal Approval screen.
Loading / empty states: empty state "No pending requests" when queue is clear.
Validation / system errors: session expiry mid-review → `/session-expired`, request state unaffected (no partial approval recorded from an expired session).
Mobile behaviour: stacked cards, same as Reviewer Dashboard pattern.
Analytics events: `custodian_queue_viewed`.

## 5. Cross-Cutting States

**Session expiry:** any authenticated request with an expired token → `/session-expired`, which offers a single "Log in again" action; in-progress form data (e.g. a half-written status update note) is preserved client-side where feasible and offered back after re-login, but never for anything containing decrypted report content (that's discarded — it shouldn't persist through a re-auth flow).

**Destructive confirmation:** reviewer deactivation (admin), key rotation (admin), and identity-reveal decisions (custodian) all require an explicit confirm step ("Are you sure? This cannot be undone" for deactivation/rotation; "This will permanently record your decision" for reveal approval/denial) — no destructive or irreversible action fires on a single click.

**Offline behaviour:** the public Submit form detects loss of connectivity mid-fill and shows a persistent banner ("You're offline — you can keep writing, but submission will retry once you're back online") rather than failing silently; authenticated areas (Reviewer/Admin/Custodian) simply show a generic connectivity banner and block actions until restored, since those flows have no meaningful offline-first value.

**Back behaviour:** browser back from Submission Confirmation does not resurrect the tracking ID (per that screen's entry-condition note) — it goes to the Submit form fresh. Back from Report Detail returns to Reviewer Dashboard with the previously scrolled position preserved where practical.

## 6. Permission Failure Summary

| Attempted access                                     | What the user sees                                                                     | Where they go                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Reviewer opens another reviewer's report             | Generic 403 page, no hint about the report's existence or content                      | `/403`                                            |
| Non-admin hits `/admin/*`                            | Generic 403                                                                            | `/403`                                            |
| Non-custodian hits reveal-approval endpoint directly | Generic 403, event logged as notable                                                   | `/403`                                            |
| Expired session on any authenticated route           | Session-expired screen, not a silent redirect to login (so the user understands _why_) | `/session-expired`                                |
| Invalid/expired tracking ID                          | Generic "not found," identical to any other invalid ID                                 | Stays on Track Status Result in a not-found state |

---

**QUALITY CHECK trace:**

- _New reporter, happy path:_ Home → Submit → fills form → Confirmation → saves ID → later, Track → Result "Submitted." Covered above.
- _Returning reporter, no data:_ Track with a made-up ID → generic not-found, no leak. Covered above.
- _New reporter, invalid input:_ Submit with description missing → inline validation blocks submit before any request fires. Covered above.
- _Returning reviewer, failed request:_ Report Detail load fails (network) → error state with retry, distinct from the integrity-check-failed state so the reviewer isn't confused about why content isn't showing. Covered above.
