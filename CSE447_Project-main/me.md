# Project memory — Whistleblower / Anonymous Reporting Tool (CSE447 lab)

This is a CSE447 class project, not a production security product — but it's graded on
implementing real cryptographic primitives correctly, so treat the crypto code with the
same rigor you would for something real.

**Status:** full doc set (PRD → Engineering Plan) reviewed against the actual codebase;
gaps captured below. **F-01 (repo/skeleton/tooling) is done** — see "Tooling (F-01)"
below. Next up: F-02 (rotate the leaked secrets — still not done, see Secrets below) and
the server-side-vs-client-side crypto decision in gap #4, both of which block Phase 1
(S-01).

## Tooling (F-01)

- Converted to an **npm workspaces** monorepo (`workspaces: ["client", "server"]` in the
  root `package.json`) — one `npm install` and one `npm run dev` (via `concurrently`) at
  the repo root boots both apps; per-package `package-lock.json` files were removed in
  favor of one root lockfile. `README.md`'s Getting Started section reflects this.
- Added a **shared** `eslint.config.js` (flat config) at the repo root — Node globals for
  `server/**`, browser + React globals/plugins for `client/**` — plus `.prettierrc.json`
  / `.prettierignore`. `npm run lint` / `npm run format` / `npm run format:check` at the
  root. Ran `prettier --write .` once to establish a clean baseline (whitespace/wrapping
  only — verified via `eslint` re-run and `node --check` on every server file that
  nothing semantic changed).
- Removed the dead-code duplicates flagged in the last review
  (`server/controllers/authController.js`, `server/middleware/auth.js` — byte-identical
  to their `server/src/` counterparts and unused) and the unused `bcrypt` dependency from
  `server/package.json`.
- Verified boot from a clean install: client (`vite`) serves HTTP 200; server
  (`node src/server.js`) loads env, wires Express/routes, and reaches the Mongo connect
  call without any import/syntax errors — it can't complete a real connection in this
  sandbox (no reachable MongoDB), which is expected without real credentials, not a code
  defect.
- **Known follow-up, not fixed here (out of F-01's scope):** `npm audit` reports moderate
  vulnerabilities in `vite`/`esbuild` (dev-server request smuggling) and
  `react-router`/`react-router-dom` (open redirect) — both only fixable via a breaking
  major-version bump. Worth a deliberate upgrade pass, ideally under H-05 (hardening),
  not a silent `--force`.

## Hard constraint (from README.md, overrides the design docs below where they conflict)

Nothing under `server/src/crypto/` may import `crypto`, `crypto-js`, `node-forge`,
`elliptic`, `jsrsasign`, or any crypto library. RSA, ECC, hashing, and MAC are
hand-rolled on `BigInt`. This is the assignment's core requirement — don't "fix" a
crypto gap below by reaching for a library.

**Existing carve-out, not yet written into the README:** `rsa.js`, `bigintUtils.js`,
`hash.js`, and `atRestCipher.js` all `import crypto` — solely for `crypto.randomBytes`
(CSPRNG), never for the algorithm itself. That's the right engineering call (don't
hand-roll a random number generator), but it currently contradicts the README's literal
"nothing may import crypto" rule. If a grader reads the README literally this reads as a
violation — the README should be updated to state the randomness exception explicitly.

## Design docs

Six planning docs live in `docs/`, in dependency order:
`PRD.md` (01) → `TDD.md` (02) → `APP_FLOW.md` (03) → `DESIGN_BRIEF.md` (04) →
`BACKEND_DESIGN.md` (05) → `ENGINEERING_PLAN.md` (06). A visual mockup of the
Submit-Report screen (titled "Disclosure Intake" there) lives at
`docs/mockups/disclosure-intake.html` — it's a self-contained bundled export, open it in
a browser rather than reading the source (it's minified bundler runtime, not spec text).

`BACKEND_DESIGN.md` is the authoritative schema/API spec — it resolves the ambiguities
TDD.md left open (see §0 there: title+description are one `ciphertextBody` blob,
category stays plaintext). `ENGINEERING_PLAN.md` is the authoritative build order —
follow its phase/task sequence (F → S → IA → CF → EI → UI → H → R) when told to start
building, rather than inventing a different order. Both still assume the TDD's
WebCrypto/RSA-4096 crypto stack, which conflicts with this repo's from-scratch
constraint below — `ENGINEERING_PLAN.md`'s closing note flags exactly which tasks need
their crypto calls swapped for `server/src/crypto/*`.

## Target schema vs. actual schema — concrete deltas as of this review

`BACKEND_DESIGN.md §1` is the target. Current Mongoose models
(`server/src/models/*.js`) diverge as follows — this is the checklist for whoever
implements Phase 1–3 of `ENGINEERING_PLAN.md`:

- **`reports`**: target has `ciphertextBody`/`nonce`/`authTag` (AES-GCM) +
  `wrappedKey`/`wrapKeyVersion` (RSA-OAEP-wrapped AES key) and a plaintext `category`
  enum (`safety|harassment|financial|other`). Actual `Report.js` has no AES fields at
  all — `titleEncrypted`/`descriptionEncrypted`/`categoryEncrypted`/`evidenceEncrypted`
  are separate RSA-encrypted-in-place fields, and **`category` is encrypted when the spec
  says it must stay plaintext** for triage/filtering (Backend Design §0 calls this out
  explicitly as the kind of mistake that's easy to make by accident — it happened here).
  `status` enum is also literally different: `Open|Investigating|Resolved` in code vs.
  `submitted|under_review|resolved` in the spec.
- **`statusLog` / `readReceipts`**: target has these as top-level collections (each with
  its own index, per Backend Design §6 — e.g. `statusLog`'s compound
  `{reportId:1, timestamp:1}`). Actual `Report.js` embeds them as subdocument arrays on
  `Report`. Not necessarily wrong, but it's a deliberate deviation from the spec's
  indexing plan if kept — decide and note it, don't let it happen silently.
- **`users`**: target role enum is `reviewer|admin|custodian`; actual is
  `reporter|reviewer|admin` (reporters don't have accounts at all per PRD Goal 1, so
  `"reporter"` shouldn't be a role value — and `"custodian"` is missing, see below).
- **Missing entirely**: `custodianKeys`, `reportIdentities` (as its own collection —
  currently a field on `Report`), `revealRequests`, and a standalone `auditLog`
  collection (there's an `AuditLog.js` model already, so that one's closer — verify it
  matches Backend Design §1's field list, in particular that no content-shaped field
  ever gets added to it).

## Where the docs and the actual code disagree (crypto-architecture level)

**1. No hybrid (envelope) encryption — a correctness bug, not just a gap.** RSA-OAEP has
a hard plaintext-size ceiling tied to the modulus (roughly `modulusBytes - 2*hashLen -
2`); at the RSA-1024 keysize currently used (`keyManager.js: rsa.generateKeyPair(1024)`),
that's on the order of tens of bytes — nowhere near enough for a report description.
Direct RSA on report fields (what `Report.js`'s field comments describe) will not work
for real report text. This is now precisely specified, not just gestured at: implement
the AES-GCM + RSA-OAEP-wrap scheme exactly as `BACKEND_DESIGN.md §1`'s `reports` table
and `ENGINEERING_PLAN.md` tasks S-01/CF-01 describe it, using the from-scratch primitives
in `server/src/crypto/` (there's no AES implementation there yet — `atRestCipher.js` is
the closest existing symmetric cipher, check whether it's reusable or whether a proper
AES-GCM needs to be written).

**2. Identity-custodian separation (PRD FR-08) doesn't exist yet, but is now fully
specified.** `custodianKeys` (k-of-n shares, its own collection/access path) and
`revealRequests` (approvals array, threshold copied at request time) are spelled out in
`BACKEND_DESIGN.md §1` and sequenced as `ENGINEERING_PLAN.md` tasks IA-06/CF-02/CF-11.
The one thing genuinely still open is organizational, not technical: **who holds the
custodian role and what k-of-n threshold** — ship with a configurable threshold per the
plan, don't hardcode a guess.

**3. RSA-1024 vs. the TDD's/Backend Design's RSA-OAEP-4096.** Almost certainly a
deliberate tradeoff (pure-`BigInt` modexp/keygen at 4096 bits is slow), but worth being
explicit about: 1024-bit RSA is not a real security margin. Fine for a lab demo, but
don't describe it as matching the spec's stated algorithm without a note explaining why
it's smaller.

**4. Server-side crypto, not client-side.** The TDD's/Engineering Plan's core trust
boundary is that report plaintext never reaches the server. The current backend does the
encryption itself (`reportController.js`'s TODOs call `rsa.encrypt`/`ecc.encrypt`
server-side on the request body) — a reasonable simplification given the from-scratch
constraint (hand-rolled crypto in the browser is a much bigger lift than server-side),
but it's a different trust model than the docs claim, and admin content-blindness (FR-06)
becomes purely an API/route discipline instead of a structural guarantee. **Decide this
explicitly before Phase 1 (S-01)** — if staying server-side, say so and update the
acceptance criteria that assume client-side encryption (S-01, CF-01, CF-02 all currently
say "client encrypts"); don't let the docs and the code quietly disagree about where
plaintext lives.

## Dead code / cleanup found during this review (not fixed, just flagged)

- `server/controllers/authController.js` and `server/middleware/auth.js` are byte-for-byte
  duplicates of `server/src/controllers/authController.js` and
  `server/src/middleware/auth.js`. `server.js` only wires up the `src/` versions
  (confirmed via `routes/` imports) — the top-level copies are unused and should be
  deleted once someone confirms nothing else references them.
- `bcrypt` is listed in `server/package.json` but never imported anywhere; password
  hashing is a hand-rolled salted/iterated SHA-256 in `crypto/hash.js` (100k rounds,
  timing-safe compare) — consistent with the from-scratch constraint, but the unused
  `bcrypt` dependency should come out.
- `reportController.js` is fully stubbed (`501 not implemented` on every route) — the
  gaps above (#1, #2) need to be resolved _before_ implementing it, not discovered after.

## Secrets

`server/.env.example` was added (placeholders only) since `README.md` references
`cp .env.example .env` but the file didn't exist. **A real `.env` with live-looking
MongoDB Atlas credentials, a session secret, and a key-encryption secret was shared as an
upload in the session that produced this file.** It was not committed here (`.gitignore`
already excludes `.env`), but those values have now left the intended trust boundary
(pasted into a chat/upload) — treat them as compromised and rotate the Atlas password,
`SESSION_SECRET`, and `KEY_ENCRYPTION_SECRET` before relying on them again, regardless of
whether this repo is public or private.
