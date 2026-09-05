# Technical Design Document — Whistleblower / Anonymous Reporting Tool

Document 02/06. Companion to the PRD (Document 01/06). Stack: MongoDB, Express, React, Node.js (MERN).

---

## 1. System Context & Architecture

**Actors:** Reporter (unauthenticated, browser only), Reviewer (authenticated), Admin (authenticated), Identity Custodian(s) (authenticated, restricted role — see TDD §4.4 / PRD FR-08).

**Components:**

- **Client (React SPA):** renders the submission form, status lookup, reviewer dashboard, admin console. Performs client-side encryption (report body, identity field) before anything reaches the network — this is the core trust boundary of the whole system.
- **API server (Node.js + Express):** stateless REST API. Never receives a private key, never performs the encryption/decryption of report content — only stores/serves ciphertext and enforces RBAC.
- **Database (MongoDB):** stores ciphertext, wrapped keys, metadata, the hash-chained status log, and the KMS's encrypted-at-rest private key material. Never stores plaintext report content or plaintext private keys.
- **Key Management Module:** logically separate service layer within the backend (not a separate deployable in V1) responsible for issuing/rotating reviewer keypairs and managing the identity-custodian key(s). Its own signing/wrapping key (`KMS_MASTER_KEY`) is the one genuinely sensitive secret in the system.
- **External services:** TOTP/2FA (library-based, no third party required), email/SMTP relay for reviewer/admin account notifications only (never report content).

**Trust boundaries (the important part):**

1. **Reporter's browser ↔ everything else.** The reporter is never authenticated and never trusted with any key beyond what they generate transiently in-browser for their own submission. Once the tracking ID is issued, the browser session holds nothing sensitive.
2. **API server ↔ database.** The server is trusted to enforce RBAC and route requests, but is explicitly _not_ trusted with plaintext — this is why encryption happens client-side wherever feasible (see TDD §6, Decision: Client-side vs. server-side encryption).
3. **Reviewer's browser ↔ their private key.** A reviewer's private key is decrypted into their authenticated session only, never persisted in browser storage beyond the session, never logged.
4. **Identity-custodian key ↔ everyone else.** Structurally isolated: no reviewer or admin code path can invoke it (PRD FR-08).
5. **Admin ↔ report content.** Admin's API scope is schema-level restricted to metadata collections/fields — this is enforced in the database access layer, not just the API route layer, so a bug in one layer doesn't collapse the boundary.

```
[Reporter Browser] --TLS--> [Express API] --Mongo driver--> [MongoDB]
        |  (client-side crypto)              |
        |                                     |-- KMS module (key issuance/rotation)
[Reviewer Browser] --TLS--> [Express API] --> [MongoDB]
        |  (client-side crypto, session)
[Admin Browser] --TLS--> [Express API] --> [MongoDB: metadata/audit collections only]
[Identity Custodian Browser] --TLS--> [Express API] --> [KMS module: custodian key ops only]
```

## 2. Frontend, Backend, Data, Hosting & Deployment

| Area     | Choice                                                                                                                                                                         | Notes                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend | React (Vite build), no SSR needed — this is an app behind auth for two of three roles, and the public-facing part (submission + tracking) is simple enough not to need SEO/SSR | WebCrypto API (or a vetted wrapper like `libsodium-wrappers`) used for all client-side crypto                                                                                                         |
| Backend  | Node.js + Express, REST (not GraphQL)                                                                                                                                          | Small, well-understood surface area; REST keeps the "what data does this endpoint return" question easy to audit per role, which matters a lot for the admin content-blindness requirement            |
| Data     | MongoDB (single region initially)                                                                                                                                              | Document model fits the report/status-log shape naturally (see §3); region choice should follow wherever the organization's data-residency obligations point — flagged as an open question in the PRD |
| Identity | Custom auth (Passport.js or equivalent) + TOTP 2FA for Reviewer/Admin/Custodian; Reporter has no identity/session                                                              | Reporters are structurally not an "identity" — this is a feature, not a gap                                                                                                                           |
| Delivery | CI/CD via GitHub Actions; hosting TBD between a managed Node host (Render/Railway) and containerized deployment (Docker + a cloud provider)                                    | Preview environments needed for reviewer-facing UI changes; rollback needs to account for the fact that a bad deploy touching the KMS module is higher-stakes than a normal rollback                  |

## 3. Data Model (MongoDB collections)

```js
// users — reviewers, admins, custodians only
{
  _id, role: "reviewer" | "admin" | "custodian",
  email, passwordHash, mfaSecret, status,
  createdAt
}

// reviewerKeys — one active document per reviewer, versioned
{
  _id, reviewerId, algorithm: "RSA-OAEP-4096",
  publicKey, encryptedPrivateKey,   // encrypted under KMS_MASTER_KEY
  version, status: "active" | "rotated" | "revoked",
  createdAt, rotatedAt
}

// custodianKeys — separate from reviewerKeys, restricted collection
{
  _id, algorithm: "ECIES-secp256r1",
  publicKey, encryptedPrivateKeyShares: [...],  // split-key if k-of-n
  threshold, version, status, createdAt
}

// reports
{
  _id, trackingId,           // indexed, public-facing lookup key
  category, title,
  ciphertextBody, nonce, authTag,   // AES-256-GCM
  wrappedKey, wrapKeyVersion,       // RSA-OAEP wrapped AES key
  hmac,
  status, assignedReviewerId,
  createdAt
}

// reportIdentities — nullable 1:1 with reports, only if reporter opted in
{
  reportId, ciphertextIdentity, ephemeralPubKey, nonce, authTag,
  custodianKeyVersion
}

// statusLog — append-only, hash-chained
{
  _id, reportId, prevEntryHash, entryHash,
  status, actorId, signature, timestamp
}

// readReceipts
{ reportId, reviewerId, openedAt }

// auditLog — admin-visible, content-free by construction (no ciphertext field exists in this collection)
{ actorId, action, targetType, targetId, timestamp, hmac }
```

Mongo-specific notes:

- `reports.trackingId` gets a unique index; it's the only lookup path for reporters, so it needs to be a high-entropy random value (128-bit), not sequential.
- `statusLog` is append-only by convention + application-layer enforcement (no update/delete route exists for this collection) — MongoDB has no native immutability, so this is enforced in code and periodically verified via the hash-chain check, not guaranteed by the database itself.
- `auditLog` and `reports`/`reportIdentities` are logically separate collections specifically so that a single overly-broad Mongo query from an admin-scoped connection can't accidentally join content in — there's no field to project even if someone tried.

## 4. APIs

| Endpoint                                                   | Purpose                                | Data exchanged                                                                          | Failure behaviour                                                                                      | Notes                                                                 |
| ---------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `POST /reports`                                            | Submit a report                        | Ciphertext + wrapped key + optional identity ciphertext (all pre-encrypted client-side) | 400 on missing required fields; 500 on server error with a generic message (no internal detail leaked) | Rate-limited per IP to reduce spam/abuse without requiring an account |
| `GET /reports/track/:trackingId`                           | Check status                           | Returns status enum only                                                                | 404 generic "not found" for invalid/expired IDs — indistinguishable from a wrong guess                 | No auth; rate-limited per IP                                          |
| `GET /reports/:id`                                         | Reviewer reads a report                | Returns ciphertext + wrappedKey for the requesting reviewer only                        | 403 if not assigned; 409 "integrity check failed" if HMAC mismatch on server-side recompute            | Reviewer session required                                             |
| `PATCH /reports/:id/status`                                | Update status                          | New status value                                                                        | 403 if not assigned reviewer; 400 if invalid transition                                                | Appends statusLog entry, signed                                       |
| `GET /reports/:id/history`                                 | View status log                        | Chain of statusLog entries                                                              | 403 if not authorized                                                                                  | Includes chain-verification result in response                        |
| `POST /reports/:id/reveal-identity`                        | Invoke custodian key                   | Custodian approval(s)                                                                   | 403 if insufficient approvals; always logged regardless of outcome                                     | See PRD FR-08                                                         |
| `POST /auth/login`, `/auth/refresh`                        | Reviewer/admin/custodian auth          | Credentials + TOTP                                                                      | 401 on failure; account lock after repeated failures                                                   | Short-lived access token (15 min), HMAC-signed                        |
| `POST /admin/reviewers`, `/admin/reviewers/:id/rotate-key` | Manage reviewers, trigger KMS rotation | Account fields only                                                                     | 403 if not admin                                                                                       | Admin never receives key material in the response                     |
| `GET /admin/audit-log`                                     | Metadata-only audit trail              | auditLog documents                                                                      | 403 if not admin                                                                                       | No content fields exist in this collection to leak                    |

**Cost/limit assumptions:** no paid external API dependencies in V1 (TOTP is self-hosted via a library, not a paid SMS provider) — main cost driver is DB storage growth from `statusLog` and `auditLog`, which is small per report (a handful of KB) and shouldn't need active management until retention policy is decided (open question, PRD).

## 5. Security & Privacy

- **Secrets (env vars only, never in code or docs):** `KMS_MASTER_KEY`, `SESSION_SIGNING_KEY`, `MONGODB_URI`, `SMTP_CREDENTIALS`. None of these are ever logged, returned in API responses, or committed to source control.
- **Encryption:** AES-256-GCM for report body; RSA-OAEP-4096 for wrapping report keys per reviewer; ECIES/secp256r1 for the identity field via the custodian key (see architecture doc / prior conversation for full crypto design).
- **Logging:** application logs capture request metadata (route, status code, actor ID, timestamp) — never request/response bodies for any report-related endpoint, to guarantee logs themselves can't become a content leak.
- **Retention:** open question (flagged in PRD) — needs a decision before launch, since it affects both `reports`/`reportIdentities` and `statusLog`/`auditLog` growth and any legal obligations.
- **Threats considered:** compromised reviewer account (mitigated by per-reviewer key wrapping + identity separation), rogue/coerced admin (mitigated by schema-level content exclusion), DB breach at rest (mitigated by encryption — a raw DB dump yields only ciphertext), tampering by direct DB access (mitigated by HMAC + hash-chained log), MITM (mitigated by TLS everywhere, not a novel design point here), client device compromise for a reporter (out of scope — see PRD risks).

## 6. Performance, Reliability, Observability, Environment

- **Performance:** expected load is low-to-moderate (organizational scale, not consumer scale) — no sharding or read-replica needs anticipated for V1; the main latency-sensitive path is reviewer report decryption, which happens client-side and doesn't block the API.
- **Reliability:** stateless API servers behind a load balancer if scaled beyond one instance; MongoDB replica set (even a small one) recommended from day one given this system's data is not something you want to lose to a single-node failure.
- **Observability:** structured logging (metadata-only, per §5) shipped to a log aggregator; alerting on HMAC/chain verification failures (should be zero — any occurrence is an incident, not noise) and on repeated auth failures.
- **Environments:** dev / staging / production, each with separate `KMS_MASTER_KEY` and `MONGODB_URI` — staging must never point at production data given the sensitivity here; seed/test data for staging should be synthetic, not copied-and-scrubbed production reports.

## 7. Major Decisions

**DECISION: Client-side vs. server-side encryption**

- Status: Accepted
- Context: The core guarantee is that the server should never see report plaintext, even transiently.
- Options considered: (A) Server-side encryption immediately on receipt over TLS; (B) Client-side encryption before the request leaves the browser.
- Choice: B — client-side.
- Reason: Server-side encryption still means the server handles plaintext for at least one request lifecycle, which is a strictly weaker guarantee and a bigger attack surface (memory dumps, logging accidents, a compromised server process). Client-side means the plaintext never exists outside the reporter's own browser.
- Consequences: Requires reliable WebCrypto support in the reporter's browser (PRD assumption); harder to debug ("did encryption fail or did the network fail?") since the server can't inspect payloads; slightly more complex frontend code.
- Revisit when: If browser compatibility issues cause a meaningful drop in submission completion rate (PRD success signal), reconsider a server-side fallback path with an explicit, visible trust tradeoff disclosed to the reporter.

**DECISION: REST vs. GraphQL for the API**

- Status: Accepted
- Context: Need an API style that makes it easy to audit "what can each role actually retrieve."
- Options considered: (A) REST with per-role endpoints; (B) GraphQL with field-level resolvers and role-based field permissions.
- Choice: A — REST.
- Reason: GraphQL's flexibility is exactly the risk here — a single overly-permissive resolver or schema field could let an admin-scoped query reach into content fields. REST endpoints with fixed response shapes per role make the "admin never gets content" guarantee auditable by just reading the route handlers.
- Consequences: Slightly more endpoint sprawl than a single GraphQL endpoint would need; frontend makes more distinct requests for dashboard views.
- Revisit when: If the frontend's data-fetching needs grow complex enough that REST endpoint sprawl becomes its own maintenance burden — unlikely at this system's scale.

**DECISION: MongoDB collection separation for admin content-blindness**

- Status: Accepted
- Context: Need the "admin can't read content" guarantee to survive future code changes, not just today's careful API design.
- Options considered: (A) Single `reports` collection with field-level projection in admin queries; (B) Physically separate collections (`reports`/`reportIdentities` vs. `auditLog`) with no content fields existing in the admin-accessible collection at all.
- Choice: B.
- Reason: Field-level projection is a runtime discipline that a future engineer can accidentally break (one missing `.select()`/projection call and content leaks). Collection separation makes the leak structurally impossible — there's no field to forget to exclude.
- Consequences: Some duplication of metadata (e.g. `status`, `createdAt`) exists in both `reports` and effectively derivable audit views — minor storage cost, worth it for the guarantee.
- Revisit when: Not anticipated to change; this is a foundational safety property, not a performance-driven choice.

**DECISION: Identity-custodian key held outside the reviewer key pool**

- Status: Accepted
- Context: PRD FR-08 requires that unmasking a reporter's identity can't be done by a compromised reviewer account alone.
- Options considered: (A) Same KMS-managed key as reviewers, just a different keypair; (B) Structurally separate custodian role/collection with its own restricted access path, optionally split-key (k-of-n).
- Choice: B.
- Reason: If the custodian key lived in the same `reviewerKeys` collection/access path, a privilege-escalation bug in one place compromises both guarantees at once. Separation means an attacker needs to compromise two genuinely different subsystems.
- Consequences: More operational complexity — organization needs to actually designate custodian(s) (open question in PRD) and decide on a threshold scheme.
- Revisit when: Once the organization decides who holds this role in practice (PRD open question) — that decision may affect whether k-of-n splitting is needed or a single trusted custodian suffices for V1.

**DECISION: Hosting — managed platform vs. self-managed containers**

- Status: Proposed
- Context: Need to pick where this actually runs before launch.
- Options considered: (A) Managed Node hosting (Render/Railway/similar) with a managed MongoDB (Atlas); (B) Self-managed Docker containers on a cloud VM/Kubernetes.
- Choice: Not yet finalized — leaning A for V1 given team size and the goal of minimizing ops overhead for a small project.
- Reason: A is faster to stand up and maintain with limited team bandwidth; B offers more control over data residency and infrastructure, which matters more once the retention/residency open question is resolved.
- Consequences: A ties the project to a vendor's operational model and pricing; revisit if data-residency requirements (open question, PRD) rule out the chosen vendor's available regions.
- Revisit when: Data-residency/legal requirements are resolved, or if usage scale changes the cost calculus.

## 8. Baseline Technical Brief

| Area     | Decision                                                                                    | Reason / constraint                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Frontend | React (Vite), client-side WebCrypto                                                         | Public submission flow needs no SSR/SEO; encryption must happen before data leaves the browser                                     |
| Backend  | Node.js + Express, REST                                                                     | Small team, auditable per-role response shapes, no need for GraphQL's flexibility                                                  |
| Data     | MongoDB (region TBD, pending residency decision), replica set from day one                  | Document model fits report/log shape; reliability needs a multi-node setup even at small scale                                     |
| Identity | Custom auth (Passport.js) + TOTP 2FA for Reviewer/Admin/Custodian; no identity for Reporter | Matches RBAC in PRD; reporters are deliberately anonymous by design, not by omission                                               |
| Delivery | GitHub Actions CI/CD; hosting decision pending (managed platform leaning, see §7)           | Preview environments needed for reviewer/admin UI iteration; rollback plan must account for KMS-touching deploys being higher-risk |

---

> **Reality check (added during memory review, 2026-09-02):** this TDD assumes WebCrypto / library-based AES-GCM + RSA-OAEP-4096 + ECIES. The actual repo (`README.md`) imposes a stricter, conflicting constraint for the class assignment: no `crypto`, `crypto-js`, `node-forge`, `elliptic`, etc. under `server/src/crypto/` — RSA, ECC, and hashing are hand-rolled on `BigInt`. See root `CLAUDE.md` for the specific places the implementation and this document currently diverge (no AES/hybrid envelope layer, no custodian role/key, RSA-1024 instead of 4096, server-side-only crypto instead of client-side).
