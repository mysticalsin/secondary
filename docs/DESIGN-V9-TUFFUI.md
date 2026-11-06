# Secondary v9: TUFFUI design-system upgrade

Date: 2026-11-06. Plan: Claude Opus. Sponsor: Tony ("use these to push the visuals to the next level").

**Source:** https://tuffui.com, repo `yurigdesigner/tuffui`. 76 components for AI chat and agent UIs, installed with the shadcn CLI, so the source is copied into our repo.

**Verified 2026-11-06:**
- Root `LICENSE` is MIT ("Copyright (c) 2026 TUFFUI contributors"). `package.json` licence is MIT.
- Stack: React 19.3, Tailwind v4, `radix-ui`, `motion` 14, `cmdk`, `lucide-react` and `@phosphor-icons/react`, `shiki` (code blocks).
- The library is the origin of the dot visuals Tony shared earlier: Match Field, Dot Histogram, Tick Gauge, Mirror Strips, Radial Dots.

## 1. Platform upgrade (prerequisite)

- Upgrade `apps/web` to **React 19** and `@types/react@19`.
- Re-run every test and fix breaking changes. These include ref-as-prop, `useFormState` renamed to `useActionState`, and stricter StrictMode effects.
- Add **Tailwind v4** scoped to the app:
  - Map Mantu tokens into the Tailwind theme: purple `#6600AE`/`#7F00DA`, yellow `#F8F060`, dark `#1A0033`, the light shell tokens from v4, and the Carlito/Calibri font stack.
  - Keep existing CSS working during migration by ordering cascade layers so Tailwind preflight does not break current views. Then migrate views progressively.
- `shadcn` CLI init with `components.json`. Pin the registry source and record component versions and commit in `docs/research/TUFFUI-ADOPTION.md`.
- **Supply chain:**
  - Review each copied component's code: no network calls, no telemetry, no eval, no `dangerouslySetInnerHTML` on untrusted data.
  - Keep the MIT notice in `THIRD_PARTY_NOTICES.md`.
  - Check whether the shadcn CLI collects telemetry, and disable it if it does.
  - Lockfile committed. `pnpm audit` gate.
- **Re-theme every adopted component to Mantu brand:**
  - TUFFUI's silver primary becomes Mantu purple.
  - Status tones map to our semantic colours: OK blue, fail magenta, review amber, needs-you yellow.
  - Fonts: Carlito, plus a mono for numbers.

## 2. Component mapping (only where it fits a real use case)

| Secondary surface | TUFFUI component(s) | Replaces |
|---|---|---|
| Brain Insights › constellation | **Match Field** | our `DotConstellation` |
| Brain health, Graph latency | **Dot Histogram** | our `Beeswarm` |
| Health › success vs SLO | **Tick Gauge** | v7 gauge |
| Brain pulse, week-over-week | **Mirror Strips**, **Radial Dots** (activity by hour/day) | v8 pulse visuals |
| KPI numbers | **Rolling Number** | static numbers |
| My Agent | **Streaming Message** (citations, collapsible reasoning hidden for us), **Source List**, **Agent Composer** (Ask mode only; no Act), **Prompt Suggestions**, **Agent Status**, **Response Feedback**, **Chat Thread**, **Conversation List** | v6 panel internals |
| My Agent clarifying questions | **Agent Question** (choice cards) | new |
| GenUI answer cards | **Chart Card**, **Data Answer** patterns, used as registered components in the agent library, props stay queries | some v5 cards |
| Review desk | **Tool Approval Queue** pattern (triage by risk, select several), **File Changes** pattern (split review, keep/revert hunk becomes accept/reject change) | v8 review internals. The every-change-seen and two-person rules still apply, and "grant always" is NOT offered. |
| Settings › Agents | **MCP Servers** (status, auth, reconnect, per-tool toggles) | v4/v3 agents page |
| Usage | **Usage Summary**, **Context Window Meter**, **Rate Limits** | usage view |
| Activity log detail | **Run Trace** (where time, tokens and cost went for an agent turn or ingest), **Checkpoint Timeline** (page revisions: scrub, see change, restore through review) | v7 detail |
| Foundations everywhere | Surface/Shell/Panel, Action Button, Status Pill, Segmented Control, Tabs, Tooltip, Action Menu, Popover, Modal Sheet, Toast Stack, Select, Disclosure, Agent Avatar, Skeleton, Key Hint, Empty State, Date Field, Drop Zone (import), Text Field | hand-built controls |
| ⌘K | `cmdk`, styled with TUFFUI Surface | v8 palette |

**Not adopted** (no use case, or it conflicts with our rules):
- Coding Agent, Terminal Output, Booking Assistant, Support Widget.
- Handoff Inbox (customer support).
- Background Agents Panel, until we run background agents.
- Memory Panel as an agent-memory UI. Our "memory" is the governed brain, and editing goes through review. We may reuse its visual for My Personal Brain's quick-capture list only.

## 3. Rules that stay

- The governed brain model is unchanged:
  - Isolation per brain.
  - Role-based see/do.
  - Every change seen before approve.
  - Two-person rules.
  - The AI gate.
  - No model-generated code is executed.
- Agent components never offer "act", "always allow" or write tools beyond the existing review flow.
- Accessibility: TUFFUI ships keyboard and ARIA support. We still run axe at zero violations at 1280 and 400, in FR/EN and dark mode, with table twins for every chart.

## 3b. Operate console (from TUFFUI "Agent Console" screen, source shared by Tony)

**Layout to reproduce:**
- A collapsible sidebar from 56rem (232 to 64 px with tooltips), an in-place drawer below that.
- A header with title, environment tag and incident pill.
- One vertical scroll.
- From 64rem, a right side column of 21rem.
- Container queries (`@container`), motion with `MotionConfig reducedMotion="user"`, and toasts inside the screen.

**Where:** Settings › Operate (admins). Stewards get the same console filtered to their brains.

| Console section | Secondary use case (real data, no content) |
|---|---|
| **Incident banner + ToolApprovalQueue (flat)** | Incident mode on (the v7 EXCEPT switch), or a kill switch tripped. Shows pending items that need a decision now: rule publications awaiting a second person, credential rotations, restore requests, and rights export/erase. Each still follows its own two-person rule. There is no "always allow". |
| **StatGrid with sparklines** | Ingest success %, agent turns/day, proposals waiting, median time to decision, knowledge gaps open, ACL freshness %. |
| **BackgroundAgents grid** | Live tiles for what runs in the background: connector syncs per source, nightly lint/dreaming per brain, journal job, retention job, backups. Each shows status and last/next run. Clicking opens the Activity log. |
| **RunTrace (flame)** | One selected run broken into spans: an agent turn (tools: list_brains, search, read_page, insights) or an ingest (fetch, ACL check, classifier, rule eval, review enqueue). Time, tokens and cost per span. |
| **EvalResults (compare)** | **New, real need: brain answer evals.** Per brain, a set of golden questions with expected cited pages, written by stewards. Each night Ask and My Agent are run against them, showing pass, fail or regressed against the last baseline. This catches answer quality drops after imports, rule changes or model changes. Runs only on synthetic or approved questions. Results show ids and pass/fail, not page content beyond titles the viewer can read. |
| **Side: UsageSummary, RateLimits, ContextWindowMeter** | Tokens and cost by capability and model against the tenant monthly budget. Agent rate limits (20 turns/min per person) with retry-after. The context meter for the last agent turn (system, history, evidence, tools). |
| **Team list (avatars with presence)** | Connected agent hosts (Claude Code, Codex, Dust, Copilot, Claude.ai, ChatGPT) with connection state from Settings › Agents. Never people's activity. |

### 3c. More components (sources shared by Tony on 2026-11-06)

| TUFFUI component | Secondary use cases | Data rules |
|---|---|---|
| **BlastRadius** (rings of hops around an entity; the affected set traced in red back to the centre; dashed means indirect; keyboard order) | (1) **Access radius** of a person or an MCP agent connection: the brains, collections, accounts and NDA grants it reaches through role grants, memberships, Everyone-at-Mantu and named grants. Shown in Members and access, Settings › Agents (revoke preview), and offboarding. "Affected" means what a compromised token or a pending change would expose. (2) **Change impact:** a contradicted fact or a revoked SharePoint permission, traced to dependent pages, facts and saved views that must be re-reviewed (dependency invalidation, EP-09). (3) **Rule impact** preview for v7 rules. | Server computes the graph from policy and wiki links for the viewer. Only nodes the viewer may see are sent: hidden brains are omitted, not shown as locked. Labels are masked per viewer. An admin sees structure (brain and collection names) but never page content. |
| **HexDensity** (2D hex-binned density with a threshold line splitting accent and muted halves, densest-bin callout, keyboard bins) | (1) **Retrieval quality:** chunks by relevance score (y) against freshness in days (x), with the retrieval cut-off ("retrieved" / "dropped"). Shown in Operate › Evals and in My Agent's "Why these sources" disclosure. (2) **Brain health 2D:** pages by freshness (x) against the verified-facts share (y), with the threshold at the review standard. (3) **Review analytics:** proposal size against time to decision. | Points are numeric only (ids are kept server-side for drill-down). Drill-down returns titles only for readable pages. |

Both components are adopted from the TUFFUI repository at the pinned commit through the shadcn CLI, re-themed to Mantu tokens (brand = Mantu purple, negative = magenta), and keep their keyboard and ARIA behaviour. Every chart also gets a table twin.

The reference source is kept at `docs/design-refs/tuffui/agent-console.reference.tsx` under the MIT licence of TUFFUI contributors. It is for reference only, and is not imported until the v9 platform upgrade.

## 4. Sequencing

1. Merge the in-flight branches first: v7 rules, v7 ops, v8 review and v8 lens.
2. Then do the platform upgrade (React 19 and Tailwind v4) on its own branch, with all tests green before any visual change.
3. Then adopt components surface by surface, with screenshots before and after for each, and compare against the TUFFUI demos.
4. Then deploy.
