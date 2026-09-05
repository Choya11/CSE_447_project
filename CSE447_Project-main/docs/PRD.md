# Product Requirements Document — Whistleblower / Anonymous Reporting Tool

## PRODUCT SUMMARY

A reporting platform that lets members of an organization submit misconduct reports to a review committee — without creating an account, and with their identity cryptographically separated from report content — so reporters can raise concerns safely and reviewers can act on them without either side having to trust the other's discretion alone.

## TARGET USER & CURRENT ALTERNATIVE

- **Primary user (Reporter):** an employee, student, or member of an organization who has witnessed or experienced misconduct and needs to report it. The problem occurs episodically and often under stress — the reporter may fear retaliation, may not trust that HR/administration will keep their identity confidential, and needs some way to follow up without re-exposing themselves.
- **Secondary user (Reviewer):** a member of the review committee responsible for triaging and investigating reports. They need reliable access to report content, a way to track status without losing history, and confidence that reports weren't tampered with before they saw them.
- **Tertiary user (Admin):** manages reviewer accounts and monitors system health/activity, but is explicitly _not_ a trusted party for report content.
- **Current alternative:** email to a designated officer, a paper/physical drop box, a generic contact form, or a third-party hotline service. These typically either (a) tie identity to the report by default (email headers, form metadata), (b) give no way to check status without re-contacting someone, or (c) put full trust in whoever operates the inbox, with no tamper-evidence on the record afterward.

## V1 GOALS / NON-GOALS

**Goals:**

- Let a reporter submit a report with zero account creation, and check its status later using only a tracking ID.
- Guarantee that report content is unreadable by anyone except an assigned reviewer.
- Guarantee that reporter identity (when supplied) requires a _second, separate_ key beyond what any single reviewer holds.
- Make any post-submission tampering with a report or its status history detectable.
- Give admins the ability to manage reviewer accounts and see system activity without being able to read report content.

**Non-goals (V1):**

- Case management workflow beyond status + assignment (no investigation notes, evidence file uploads, or committee voting — text-only evidence field is in scope, file attachments are not).
- Multi-organization / multi-tenant support.
- Reporter-to-reviewer two-way messaging (status is one-directional in V1; reporters see status, not comments).
- Mobile native apps (responsive web only).
- Configurable/custom RBAC roles beyond Reporter, Reviewer, Admin.

## REQUIREMENTS

### Must-have

**FR-01 — Anonymous report submission**
Acceptance criteria:

- Given a visitor with no account, when they submit a report with title, description, and category, then the system stores it encrypted and returns a tracking ID shown only once.
- Given the same flow, when the reporter optionally adds identity info, then it is encrypted with a separate key from the report body before storage.
- Failure/empty: submission is rejected client-side if title, description, or category is missing; a network failure during submission shows a retry option without discarding the drafted text.

**FR-02 — Status tracking via tracking ID**
Acceptance criteria:

- Given a valid tracking ID, when a reporter (no login) submits it, then they see the current status (e.g. Submitted / Under Review / Resolved) and nothing else.
- Given an invalid or already-expired tracking ID, when submitted, then the system shows a generic "not found" message — never a hint about which part was wrong.
- Loading: status lookup shows a loading indicator and times out gracefully with a retry option.

**FR-03 — Reviewer authentication with 2FA**
Acceptance criteria:

- Given a reviewer account, when logging in, then password + TOTP 2FA are both required before a session is issued.
- Given 3 failed 2FA attempts, when the next attempt occurs, then the account is temporarily locked and the event is written to the audit log.

**FR-04 — Reviewer report access (assigned only)**
Acceptance criteria:

- Given a reviewer is logged in, when they open a report assigned to them, then the content decrypts and displays.
- Given a reviewer is logged in, when they attempt to open a report _not_ assigned to them, then access is denied and the attempt is logged.
- Failure: if the stored HMAC does not match a recomputed HMAC on read, the report is flagged as "integrity check failed" and blocked from display rather than shown.

**FR-05 — Status updates with tamper-evident history**
Acceptance criteria:

- Given an assigned reviewer, when they change a report's status, then a new signed, chained log entry is appended and the reporter's tracking view updates.
- Given any existing log entry, when someone attempts to edit or delete it directly (e.g. via DB access), then the hash chain fails verification on next read and is surfaced to admins.
- Failure: a status update with no reviewer session attached is rejected.

**FR-06 — Admin reviewer management, content-blind**
Acceptance criteria:

- Given an admin, when they create/deactivate a reviewer account or trigger a key rotation, then the action succeeds and is recorded in the audit log.
- Given an admin, when they view any report-related screen, then no report title, description, or identity field is ever rendered or returned by the API — only metadata (status, category, timestamps, assignment).
- Failure: any admin API request that would return report content is rejected server-side (defense in depth, not just hidden in the UI).

**FR-07 — Key management (KMS)**
Acceptance criteria:

- Given a new reviewer account, when it's created, then a keypair is generated and the private key stored encrypted-at-rest, never returned in plaintext to any client response.
- Given a key rotation is triggered, when it completes, then previously wrapped report keys are re-wrapped under the new key and the old private key is destroyed.

**FR-08 — Identity reveal governance**
Acceptance criteria:

- Given a report has an encrypted identity field, when someone attempts to reveal it, then the action requires explicit invocation of the identity-custodian key by an authorized custodian — never by a reviewer or admin acting alone.
- Given the identity-custodian role is split (k-of-n), when a reveal is attempted, then it is blocked until the required number of custodian approvals is met.
- Given a reveal attempt (successful or blocked), when it occurs, then it is written to the status_log as a signed, chained entry — same tamper-evidence guarantee as any other status change (see FR-05).
- Failure: a reveal request missing sufficient custodian approvals is rejected outright, not queued or partially processed; the rejection itself is still logged.

### Later (post-V1)

- Reporter-facing threaded comments/replies from reviewers.
- Evidence file upload (with its own encryption path).
- Configurable multi-stage review workflow (e.g. triage → investigation → resolution with sub-statuses).
- Exportable, cryptographically verifiable audit reports for external compliance review.
- Multi-language reporting UI.

## USER STORIES WITH ACCEPTANCE CRITERIA

**US-01:** As a reporter, I want to submit a report without creating an account, so that I don't have to link my identity to the act of reporting.

- Given I'm on the submission form, when I fill it out and skip the optional identity field, then my report is stored and I receive a tracking ID with no account created.

**US-02:** As a reporter, I want to check on my report later, so that I know whether it's being looked at.

- Given I saved my tracking ID, when I return days later and enter it, then I see the current status without logging in.

**US-03:** As a reviewer, I want to read only the reports assigned to me, so that access is limited to what I'm responsible for.

- Given I'm logged in, when I view my dashboard, then I see only reports currently assigned to me, not the full report list.

**US-04:** As a reviewer, I want to trust that a report I'm reading hasn't been silently altered, so that my decisions are based on the original account.

- Given I open a report, when the system recomputes its HMAC and it doesn't match, then I see an integrity warning instead of the content.

**US-05:** As an admin, I want to manage reviewer accounts and rotate keys, so that access stays current without me ever needing to read report content.

- Given I'm logged in as admin, when I browse any part of the system, then no report body or identity field appears in any view or API response I can access.

**US-06:** As an organization stakeholder, I want confidence that no one can rewrite report history after the fact, so that the process is defensible if challenged.

- Given a report has multiple status changes, when I (as an authorized auditor) verify the chain, then any tampering is detectable without needing to trust the database directly.

## SUCCESS SIGNALS

- **Submission completion rate:** % of started submissions that are completed — target ≥85% within first 3 months (baseline: unknown, first release).
- **Tracking ID lookup success rate:** % of status checks that return a valid result on first attempt (excludes intentionally invalid IDs) — target ≥95%.
- **Time-to-first-status-update:** median time from submission to first reviewer status change — target established after 1 month of baseline data, then tracked for reduction.
- **Integrity check failures:** count of HMAC/chain verification failures per month — target 0; any nonzero value triggers investigation, not a product metric to "improve."
- **Admin content-exposure incidents:** count of any confirmed instance of report content reaching an admin view — target 0, monitored via audit log review.

## ASSUMPTIONS / RISKS / OPEN QUESTIONS

**Assumptions:**

- Reporters have access to a modern browser capable of running client-side encryption (WebCrypto or equivalent); no support planned for very old browsers in V1.
- The organization has at least two people willing to hold the identity-custodian role/key, or an accepted process for split-key custody.
- Reviewers are relatively few in number (single-digit to low tens) — V1's per-reviewer key-wrapping approach doesn't need to scale to thousands of reviewers.

**Risks:**

- If a reporter loses their tracking ID, there is currently no recovery path by design (recovery would require identity linkage) — this is a deliberate tradeoff but should be clearly communicated in the UI to avoid support burden.
- Client-side encryption depends on the reporter's device being uncompromised; malware on their machine is outside this system's threat model.
- Identity-custodian key becomes a single point of failure/coercion if only one person holds it — recommend split-key custody, but this adds onboarding complexity.

**Open questions:**

- Should reviewers see a shared queue of unassigned reports, or does an admin/lead reviewer explicitly assign them? (Affects FR-04 and the data model's `assigned_reviewer_id` semantics.)
- What's the retention policy for resolved reports — kept indefinitely, or purged/archived after some period? Affects both storage and legal-compliance requirements.
- Is there a legal or regulatory requirement (e.g. whistleblower protection law in the relevant jurisdiction) that mandates specific retention, reporting, or non-retaliation features not yet captured here?
- Who exactly holds the identity-custodian key in practice — a named role, a rotating committee, or an external party, and what k-of-n threshold applies (FR-08)? This needs an organizational decision, not just a technical one.
