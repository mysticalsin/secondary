# Secondary v8: from good to amazing

Date: 2026-11-06. Plan: Claude Opus. Sponsor: Tony.

**Sponsor feedback:** features are missing, the visuals can go further, and "Waiting for you" is not good enough.

This document ranks the additions. It uses the same visual language as v5 and v7: dark instrument cards on a light shell, dot data, mono numbers and chips. The v4 rules all still apply: isolation per brain, role-based access, the AI gate, and no content in logs.

## 1. Review desk (replaces "Waiting for you")

**Problem:** today it is a flat list of cards. A reviewer cannot tell what matters, why, or how much effort each item needs.

**Layout:** three columns on desktop, a stacked flow on mobile.

- **Left, queue:**
  - Sections: **Your decision** (sorted by priority), **Contradictions**, **Mentions**, **FYI** (approved by others, informational), **Snoozed**.
  - Priority = blocking weight + age against the review SLA + brain sensitivity (account, global) + risk flags.
  - Each row shows: brain chip, kind (new page, change, contradiction, import, agent session report), author or agent host, an age badge (amber near SLA, magenta overdue), risk icons, and a "~2 min" effort estimate from change size.
- **Centre, focus:**
  - **"What changed"**: a one-line summary, deterministic or AI-gated. It is a summary only; the full diff stays the source of truth.
  - Inline diff with change markers.
  - **Risk panel**: client name detected, personal data flag, confidential field, rule matched (`ruleId@v`), unsupported claims.
  - **Context**: the current page next to the proposal, plus linked facts that would be invalidated.
  - **Discussion thread** with @mentions (notifications).
- **Right, decision:**
  - Approve, which needs every change seen; the existing rule still holds.
  - Request changes (with a note), reject, reassign (to an eligible reviewer only), snooze (until a date).
  - Second-approver status.
- **Top strip (dark card):**
  - A dot timeline of incoming proposals over 14 days, coloured by state.
  - KPIs: waiting, median time to decision, overdue, "cleared this week".
- **Keyboard:** J/K to move, Enter to open, A approve, R request changes, S snooze, M mention, "?" for help.
- **Server:**
  - Review SLA per brain (default 2 business days), shown on Members and access.
  - Snooze, reassign and comments are stored per proposal and audited. Comments go through the R-110 personal-data detector, and a flagged comment warns before posting.

## 2. Knowledge gaps

- Every Ask or My Agent answer that ends in `unknown`, and every search with zero results, adds a **gap signal**: question text normalised, brain scope, asker role, count.
- The text is stored only if the asker can read that brain. Personal-data detection runs, and flagged text is dropped.
- **Brain › Gaps tab:**
  - Ranked gaps as dot rows by frequency and recency.
  - Actions:
    - **Assign** to a contributor, with a due date.
    - **Start page** from the gap, which pre-fills the title and creates a draft in review.
    - **Merge** duplicates.
    - **Dismiss**, with a reason.
- Steward KPI: "gap closure rate".
- **Home** shows "Top gaps in your brains" for stewards.

## 3. Page lens (page reading view upgrade)

The right rail of a page shows:
- **Local graph:** a mini radial with linked pages one or two hops away, inside readable brains only. Others are hidden, not shown as locked.
- **Facts timeline:** valid_from and valid_to bars, with contradictions marked.
- **Freshness badge**, plus a **"Verified by"** stamp (who and when).
- **Contributors:** avatars and roles.
- **Backlinks.**
- **Ask this page:** a scoped My Agent turn.

On top of the page, a sticky header with brain, collection, status and the last change.

## 4. Who knows

- **Per topic or collection:** contributors ranked by approved contributions and recency. The display is name, role and brain.
- Computed only from brains the viewer can read.
- Work activity only. No HR data and no personal brains.
- An "opt out of expert listing" setting per user, which the GDPR transparency requirement calls for.
- **Entry points:**
  - A Who knows card in Page lens and on the brain page.
  - My Agent can answer "who knows about pricing in Bid?" with a `PeopleList` component.

## 5. ⌘K palette and faceted search

**⌘K, everywhere:**
- Jump to a brain, page or setting.
- Run actions: new page, ask, open the review desk, pin view.
- Recent items.

**Search page:**
- Facets: brain, collection, type, freshness, status, author role.
- A results preview pane.
- Search operators (`brain:`, `type:`, `fresh:<30d`).
- Saved searches.

Everything is role-scoped. Results stay within admitted brains.

## 6. Brain pulse

The journal becomes visual: a vertical timeline per brain. Each day shows dots for published, contradictions resolved, new sources, gaps closed, and rules triggered. Clicking a day expands the entries.

Home shows **"Pulse across your brains"**: one row per brain, coloured dots per day over 30 days.

## 7. Visual polish pass

- One consistent design system document.
- **Motion:** card reveal, and list reorder with layout animation.
- **Empty states:** illustrated with brand-safe SVG.
- **Skeletons** instead of spinners.
- **Avatars:** initials in role colours.
- **Dark mode parity.**
- Every new view is compared against the v5 and v7 references, with two refinement passes.

## 8. Acceptance

- The Review desk sorts by priority. Approve stays disabled until all changes are seen. Reassign goes only to eligible reviewers. Snooze, reassign and comments are audited. Keyboard flows work. The "What changed" summary never replaces the diff.
- Gap signals never store text for brains the asker cannot read. Personal-data text is dropped. Start page creates a draft in review.
- Page lens, Who knows and search never reveal anything from unreadable brains. Expert opt-out is honoured.
- Every chart has a table twin. axe reports zero violations, FR/EN, 400 px.
