# Secondary v7: Govern and Operate

Date: 2026-11-06. Plan: Claude Opus. Sponsor: Tony.

**Visual references:**
- An access-policy editor: WHEN / THEN / EXCEPT, impact preview, sample matches, simulation, versioned publish.
- A webhook message log: dot timeline, status filters, attempts, response body, replay.
- An endpoint and retry configuration: retry schedule step chart, response-time beeswarm.
- A delivery-health dashboard: success gauge with SLO, failures by code, attempts heatmap by endpoint.

**Sponsor:** "make sure it's for the right use cases". Each reference is mapped to a real Secondary need. Nothing is added for decoration. All four surfaces are for stewards and admins. Ordinary users see none of them.

## 1. Brain rules (from access policies)

**Where:** Settings › Rules (admins: tenant-wide), and Brain › Members and access › Rules (stewards: their brain).

**Rule** = `name`, `scope` (tenant, brain type, or specific brains), `WHEN` conditions (AND), `THEN` effect, `EXCEPT` toggle, `status` (draft, monitor, enforced), `version`.

**WHEN fields:**

| Field | Values |
|---|---|
| Actor | human or agent (MCP host: claude, chatgpt, dust, codex, copilot) |
| Actor role | role names |
| Action | propose_page, propose_change, publish, export, promote_to_global, import, write_session_report, share_view |
| Brain | is any of |
| Brain type | personal, team, account, global |
| Content flags | personal-data detected, client name detected, confidential field present, unsupported claim, size > N pages |
| Account AI contract | allowed, unknown, not allowed |
| Time | weekdays, weekend, outside business hours (tenant timezone) |

**THEN effects:**
- Require review (one approver).
- Require two approvers.
- Require a named approver group (stewards, privacy).
- Block, with a message.
- Allow and notify (Waiting for you plus audit).
- Expire grant after N minutes, for agent write scopes.

**EXCEPT:** for example, "while incident mode is on, allow and notify". Incident mode is a two-person tenant switch.

**Hard floors.** Rules can **only tighten**. A rule that would loosen any of these is rejected at save with a reason:
- Personal Brain privacy.
- NDA named grants.
- Two-person release to Global.
- The every-change-seen approval rule.
- Account "Everyone at Mantu" ban.
- The AI gate.
- MCP agents always going through review in shared brains.

**Enforcement.** Server-side, in the policy decision point, evaluated on every matching action from the API, MCP, connector or import path. The effect is recorded in the audit receipt with `ruleId@version`.

**Impact preview and Run simulation.** Replays the last 7 or 30 days of audit receipts, ids and metadata only, against the draft. It shows:
- "N actions would match".
- A split bar: need approval, blocked, allowed and notified.
- Sample matches: actor, action, brain, when, and effect chip.
- An estimated added review wait.

The preview never shows content, only what the viewer may see.

**Lifecycle:**
- A draft can be saved freely.
- **Monitor mode** logs would-match without enforcing.
- Publishing `vN+1` needs a second admin or steward for rules that affect restricted, account or Global brains.
- Version history is kept, with diffs and rollback (rollback is also two-person).

**Seed rules (synthetic dev):**
- Agent proposals in shared brains need review. This is already a floor, shown read-only.
- A client name in a Global candidate is blocked.
- Exports over 50 pages need approval.
- Account AI contract unknown blocks agent writes.
- Weekend: agent writes to Bid & Pre-sales need two approvers (monitor).

## 2. Brain activity log (from message log)

**Where:** Brain › Activity (managers), and Settings › Agents › connection detail (the user's own agent calls).

**Timeline header:**
- "Last 60 min, 24 h or 7 d · 1 dot = k events".
- Coloured dots: published, needs review, blocked, failed or retrying.
- Brush to select a window.
- A failure callout, for example "blocked since 10:51 · client-name rule".

**Table:**

| Column | Content |
|---|---|
| Event | `wiki.propose_page`, `connector.sync`, `classifier.ask`, and so on, plus id |
| Source | agent host, connector or human |
| Status | chip |
| Attempts | dots |
| Latency | bar |
| Time | timestamp |

Filters: All, Needs review, Blocked, Failed. Search with "/".

**Detail panel:**
- An attempts or steps timeline (classifier verdict, rule matched `ruleId@v`, review state).
- A metadata JSON viewer showing ids, rule and verdict, **never page content**.
- Actions: **Copy event id**, and **Retry ingest** (connector or classifier failures only, idempotent, audited).
- "Replay" never re-sends content anywhere external.

**Data:** derived from audit receipts plus the connector and ingest job logs, scoped to the brain and the viewer.

## 3. Sources (from endpoint and retry config)

**Where:** Settings › Sources (admins). One page per connector source.

**Source config page:**
- Source: a SharePoint site or drive, or a folder.
- Target brain and collection.
- Event or scope chips (file types, folders), editable, "4 of N".
- Credential with **Rotate**, two-person, showing the secret name only, never the value.
- Sync schedule: delta interval.
- Retry policy: exponential (5 s to 24 h), linear, fixed, or none. "Honours Retry-After / Graph 429."
- Timeout stepper.
- ACL max age.
- Status: Active or Paused, plus "Run sync now".

**Retry schedule chart.** A step chart of the planned retries, with "next try in 22 s · last 429".

**Response-time beeswarm.** Graph call latency for the last N calls, with p50 and p95, the timeout line, a timed-out share, and a "raise timeout?" hint.

**ACL staleness strip.** The share of reads confirmed within ACL max age, with fail-closed counts.

## 4. Platform health (from delivery health)

**Where:** Settings › Health (admins).

- **Gauge:** ingest success rate against the SLO (default 99%) for the window, plus "N of M failed".
- **Outcome list:** delivered first try, recovered on retry, still failing.
- **Failures by reason:**
  - permission denied (fail-closed)
  - Graph 429
  - timeout
  - blocked by rule
  - classifier asked
  - parse error
- **Heatmap:** attempts by brain or source by hour, with failing hours highlighted and a tooltip such as "Bid & Pre-sales · 11:00 · 12 blocked · client-name rule". Columns: 1 h, 24 h, 7 d.
- **Totals:** attempts, delivered, failed.

**Isolation.** Admin health is tenant-wide counts only, never content. Stewards see the same cards limited to their brains.

## 5. Visual

The dark instrument-card language, consistent with v5:
- Blue `#38BDF8` for delivered or OK.
- Magenta `#EC4899` for failed or blocked.
- Amber `#F59E0B` for needs review.
- Purple for brand.
- Mono tabular numbers, chips, legends and table twins.

The policy editor uses the light form style of the reference: white panel, condition rows with selects and chips, AND separators, and a right-side impact preview.

## 6. Acceptance

- A rule that loosens a floor is rejected, with a reason.
- An enforced rule changes the outcome on API, MCP and import, and the receipt records `ruleId@version`.
- Simulation counts match a replay of the synthetic audit fixtures.
- Publishing a rule that affects a restricted brain needs a second person.
- Monitor mode never changes outcomes.
- The activity log never shows page content. Retry ingest is idempotent and audited.
- Source credential rotation needs two people, and the value is never shown.
- Health and activity respect scope: a steward sees only their brains.
- axe reports zero violations, FR/EN, keyboard support, and table twins for every chart.
- Screenshots are compared with the references, with two refinement passes.
