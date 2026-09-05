# UI/UX Design Brief — Whistleblower / Anonymous Reporting Tool

Document 04/06. Companion to the PRD (01/06), TDD (02/06), and App Flow & State Map (03/06).

---

## Grounding

This isn't a SaaS dashboard and it isn't a consumer app — it's closer to a **secure intake desk**: someone hands over something sensitive, gets a receipt, and later comes back to check on it without ever having to prove who they are. The design's job is to make that handoff feel safe, unhurried, and precise — never clever, never cheerful, never bureaucratic.

The one moment of real visual weight in the whole product is the **tracking ID** on the Submission Confirmation screen — it's the single artifact a reporter walks away with, so it gets the boldest treatment in the system. Everything else stays quiet and gets out of the way.

---

## DESIGN DIRECTION

**Three adjectives:** Calm. Exact. Unshowy.

**Should feel like:** a well-run records office — someone competent quietly doing careful work, nothing sold to you, nothing rushed.

**Must not feel like:** a marketing landing page, a consumer social app, a government paper form, or a "trust us" security-vendor site plastered with padlock icons and shield graphics. No badges, no gradients-as-decoration, no "your data is safe with us" reassurance copy standing in for actual design discipline.

---

## TOKENS

### Colour roles

| Role                   | Token            | Value     | Use                                                                                                                  |
| ---------------------- | ---------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| Surface (base)         | `surface-base`   | `#F7F8FA` | App background — cool paper, not cream, not pure white                                                               |
| Surface (raised)       | `surface-raised` | `#FFFFFF` | Cards, table rows, modal panels                                                                                      |
| Surface (sunken)       | `surface-sunken` | `#EEF0F3` | Disabled fields, code/mono blocks, the collapsed "optional identity" well                                            |
| Text (primary)         | `text-primary`   | `#14181F` | Body copy, headings                                                                                                  |
| Text (secondary)       | `text-secondary` | `#4B5563` | Metadata, timestamps, helper text                                                                                    |
| Text (muted)           | `text-muted`     | `#8A93A3` | Placeholder text, disabled labels                                                                                    |
| Primary (brand/action) | `primary`        | `#1F3B57` | Primary buttons, links, active nav state — deep desaturated navy, not a "tech blue"                                  |
| Primary (hover)        | `primary-hover`  | `#16293D` | —                                                                                                                    |
| Warning                | `warning`        | `#946200` | Pending/awaiting-review states, non-blocking cautions                                                                |
| Danger                 | `danger`         | `#9B2C2C` | Destructive actions, integrity-check failures, denied reveal requests — muted brick, not alarm-red                   |
| Focus ring             | `focus`          | `#2B7A78` | Keyboard focus outline — deliberately distinct from `primary` so focus is never mistaken for a selected/active state |

Six core colours, used consistently — no ad hoc greys or blues introduced per-screen.

### Typography

- **Heading & body:** IBM Plex Sans — one family for both, weight does the differentiating (600 for headings, 400 for body). Chosen because it reads as engineered and legible rather than "friendly SaaS," which matches an intake tool that needs to be trusted, not liked.
- **Mono:** IBM Plex Mono — reserved _only_ for tracking IDs, key fingerprints, timestamps in the audit log, and hashes in the status-history chain. This is a functional signal, not decoration: when something is in mono, it means "this is a precise value, copy it exactly."
- **Scale:** 13 / 14 / 16 / 20 / 24 / 32px, following a roughly 1.25 ratio. Body copy sits at 16px; nothing on the reporter-facing side drops below 14px, since these are often stressed, one-time readers, not power users skimming a dashboard.
- **Line length:** capped around 70–75 characters for report descriptions and any long-form text, per standard readability guidance.

### Spacing scale

`4 / 8 / 12 / 16 / 24 / 32 / 48 / 64` px. All margins, padding, and gaps come from this scale — no arbitrary values.

### Radius / border / shadow

- **Radius:** 4px on inputs and buttons, 8px on cards and modals. Small and consistent — enough to soften edges, not enough to read as "rounded SaaS card kit."
- **Border:** 1px hairline, `#D8DCE3` (a tint of `text-muted`), used to separate table rows and card edges instead of shadow wherever possible.
- **Shadow:** exactly one elevation level, reserved for modals and dropdowns only: `0 4px 16px rgba(20,24,31,0.12)`. Cards and dashboard widgets use borders, not shadows — this keeps the interface flat and calm rather than stacked and "floaty."

### Icon style

Single-weight line icons (1.5px stroke), no fills, no duotone, no illustration-style icons. Used sparingly — for status (pending/resolved/flagged) and for the handful of destructive/sensitive actions (rotate key, reveal identity), not as decoration next to every label.

---

## COMPONENT RULES

### Buttons

- **Primary:** solid `primary` fill, white text, used once per screen for the one intended action (Submit, Update Status, Approve).
- **Secondary:** `surface-raised` background, 1px border, `text-primary` label — for anything optional or reversible (Cancel, Check another ID).
- **Destructive:** outlined in `danger`, fills solid `danger` only on hover/press — destructive actions should never look like the default, cheerful choice at rest.
- **Disabled:** `text-muted` label on `surface-sunken`, never just a lowered-opacity version of the active state (that reads as broken, not disabled).
- **Loading:** label text is replaced by a small inline spinner + "Submitting…" style text, button stays the same width (no layout shift), and is disabled for the duration.

### Inputs and validation

- Labels are always visible above the field — never placeholder-only, since placeholders disappear exactly when someone needs the reminder most.
- Required fields are marked with a small asterisk next to the label, not a colour change alone.
- Inline validation appears on blur, not on every keystroke — errors shown below the field in `danger` text with a short line icon, never colour alone.
- The optional identity field on Submit Report is visually distinct: it lives inside a `surface-sunken` well with a collapse/expand control, so its "this is optional and separate" status is structural, not just a caption.

### Cards / tables

- Reviewer Dashboard and Custodian Queue use a **table on desktop** (status, category, assigned date, one action column) and **stacked cards on mobile** — same data, different layout, never a horizontally-scrolling table on small screens.
- Cards use borders, not shadows (see Radius/border/shadow above), and a consistent internal padding of 16px.
- Status is always shown as a small text-label pill with a colour dot, never colour-fill-only — colour is a reinforcement, not the sole signal (accessibility).

### Modals / destructive actions

- Modals are reserved for genuinely interruptive, consequential moments: key rotation, reviewer deactivation, identity-reveal approval/denial. They are not used for anything in the primary submit/track flow — those stay full-page so a stressed reporter is never dealing with a floating dialog.
- Every destructive modal has: a plain-language description of exactly what will happen (not "Are you sure?" alone), the destructive action styled per the Destructive button rule above, and a secondary Cancel that's visually the calmer of the two options.
- No modal auto-dismisses. All require an explicit action to close.

### Loading / empty / error

- **Loading:** skeleton shapes matching the eventual content's layout, not a generic spinner-in-the-middle-of-the-page — this keeps the interface feeling stable rather than jarring when content pops in.
- **Empty:** plain, direct text ("No reports currently assigned to you") — no illustrations, no jokes. This product's emptiness is often good news (nothing pending), and the copy should read as neutral information, not an apology.
- **Error:** persistent banners (not auto-dismissing toasts) for anything touching a security-relevant action — integrity-check failures, failed reveal requests, session expiry. Toasts are fine for low-stakes confirmations (e.g. "Tracking ID copied"), never for anything the person needs to actually register and act on.

---

## RESPONSIVE & ACCESSIBLE

### Breakpoints

- **Mobile:** < 640px
- **Tablet:** 640–1024px
- **Desktop:** > 1024px

### Mobile navigation

- Public area: two large tap targets on Home (Submit / Track) instead of a nav bar; staff login tucked into an overflow menu.
- Authenticated areas: sidebar (desktop) collapses to a bottom tab bar (Reviewer, Admin); Custodian's single-screen queue needs no tab bar at all.

### Keyboard and focus

- Full tab order through every interactive element on every screen; nothing reachable only by mouse/touch.
- Visible focus ring on every focusable element, using the dedicated `focus` token — never `outline: none` without a replacement.
- A skip-to-content link on every page for keyboard users, especially important on the authenticated dashboards with persistent nav chrome.

### Contrast target

WCAG AA minimum (4.5:1) for all body text; AAA (7:1) targeted specifically for `danger`-state text and integrity-check-failure messaging, since these are the moments where misreading matters most.

### Reduced motion

`prefers-reduced-motion` is respected everywhere — transitions collapse to instant state changes. No information is ever conveyed through motion alone (e.g. a status change is confirmed by updated text/colour, not just an animation that a reduced-motion user won't see).

### Touch target

Minimum 44×44px for every tappable element, including table row actions on mobile card view and the copy-tracking-ID button, which is deliberately oversized given how consequential that one tap is.

---

## Annotated References — Copy This, Not That

**Copy the _quality_, not the product:**

- **Linear's density and restraint** — one accent colour used sparingly, generous whitespace between logical groups but tight spacing within them, no decorative elements competing with content. We're borrowing the _discipline_, not their specific palette or components.
- **A well-typeset legal/records document** — for the report-reading experience specifically: clear hierarchy (title, metadata, body), generous line-height, nothing trying to be "engaging."

**Avoid — common AI-generated-design tells this brief deliberately steers away from:**

- Warm cream background + high-contrast serif + terracotta accent — reads as generic "editorial AI template," wrong tone entirely for a security tool.
- Near-black background with a single neon accent — too consumer-tech, undercuts the "quiet records office" feeling.
- The SaaS-card kit — identical rounded cards, one border-radius on everything, soft grey shadow under each — this brief uses borders over shadows specifically to avoid that look.
- Tracked-out ALL-CAPS eyebrow labels, middle-dot-joined metadata strings, arrows appended to every button/link — none of that appears anywhere in this system; labels are sentence case, plain, and single-purpose.
- Shield/padlock iconography and "your data is protected" reassurance copy — the design should _demonstrate_ the security model (e.g. showing the integrity-check-failed state clearly, showing exactly what an admin can and can't see) rather than tell the user to trust it.

---

**Note:** This brief defines _rules_, not a component library — implementation (actual React components, exact Tailwind config, etc.) is a build-time decision for whoever picks this up next, guided by these tokens and rules rather than by copying a reference product's UI wholesale.
