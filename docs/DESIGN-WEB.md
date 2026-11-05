# Secondary web UI design (Mantu brand)

Written before the UI code (standing rule). Owner: Claude Opus (plan). Sponsor: Tony.
**References:** Mantu Brand DNA visual identity (Group level), and the TOTO OS Mantu Edition look Tony already built (`AI Second Brain/99_Meta/interface/TOTO-OS-Mantu-Edition.html`, DESIGN.md there). SkillTree is **not** the visual reference. It only illustrated "departments as a map".

## 1. Brand tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#140C1C` | page (between Brand DNA `#1A0033` and TOTO `#17121A`) |
| `--panel` / `--panel-2` | `#1F1529` / `#2A1D38` | cards, raised |
| `--line` | `#3A2C4A` | hairlines |
| `--ink` / `--ink-2` / `--mute` | `#FFFFFF` / `#D9D0E4` / `#9C8FAE` | text |
| `--purple` | `#6600AE` | Mantu primary purple, brand surfaces |
| `--purple-bright` | `#7F00DA` | active tab, selected, links |
| `--yellow` | `#F8F060` | Mantu accent. Primary action, focus, "needs you" |
| Lilac ramp | `#F3E8FF #E2C8FF #D791FF #B764FF #8E3FE0 #5E2399` | depth, charts, map sectors |
| Status | open `#9C8FAE` · progress `#5CC8FF` · done `#5BE49B` · risk `#FF6B8A` | chips |
| Maturity | Discover `#9C8FAE` · In design `#D791FF` · Building `#B764FF` · Piloting `#5CC8FF` · Deployed `#5BE49B` | governance views (TOTO roadmap colors) |
| Plane badges | GLOBAL lilac · DEPARTMENT cyan · TEAM blue-lilac · ACCOUNT_RESTRICTED amber `#FFB547` | |

- **Type:** Carlito, the metric-compatible open Calibri, as Brand DNA requires, with a Calibri, system-ui fallback, for headings and body. Headings are bold with tight tracking. A mono face (JetBrains Mono) is used only for eyebrow micro-labels in uppercase with 0.12em tracking, as in TOTO.
- **Shape:** radius 14 on cards, 999 on pills. Spacing scale 4/8/12/16/24/32.
- **Motion:** 160 to 240 ms, `cubic-bezier(.2,.7,.2,1)`. Reduced motion is respected.
- **Rules:** no stock imagery and no emoji. Icons are simple line pictograms (lucide-style inline SVG). Generous whitespace, one idea per panel, and the headline does the work (Five Laws: WOW First, Clarity, Apple Mind).
- **Logo:** a "mantu" wordmark tile, white on purple, top left. It is a text wordmark until the official SVG is supplied. Do not invent a logo.

## 2. Shell

```
┌ top strip (mono micro-labels): COMPANY BRAIN · PRIVATE BY DESIGN · [env DEV] · signed in as · role      ┐
├ header: [mantu tile] Secondary / Company Brain · ⌘K search · role/persona chip · Capture (yellow)        ┤
├ left rail: Today · Map · Accounts · Governances · Review · Admin (shown only if canDo configure)       ┤
│ main view                                                         │ drawer 440 px (node or record)   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The DEV banner and persona chip are visible whenever `ENVIRONMENT=dev`. The persona chip reads "Demo persona (dev only)".

## 3. Views

1. **Today, the cockpit.**
   - Purple-gradient hero card: greeting, Toronto time, date.
   - "What you can see and do" card, with See and Do columns and the Never line.
   - Needs attention, in your scope only: open decisions, overdue commitments, reviews waiting for you, access requests (for stewards).
   - Recent approved changes in your scope.
   - A world strip for Montreal, São Paulo, Bogotá, Paris and Ho Chi Minh.
2. **Map.**
   - Lens pills: Departments, Accounts, Topics, Governances.
   - Projection pills: Ring, Clusters, List, Table.
   - **Ring** is a calm radial layout on a dark panel. Group arcs (Business lines, Corporate functions) sit as soft lilac bands. Department hubs are purple discs with white labels, circles are lilac, and topics are small dots. Size shows evidence-backed item count, opacity shows freshness, a yellow ring marks an open decision or overdue item, a small yellow star marks an approved success story, and a dashed outline marks a gap. A locked department is greyed with a padlock and its name only. Hidden scopes are absent.
   - **Clusters** uses bubble packing per department, which is readable at 433 use cases.
   - Clicking a node opens the drawer. Breadcrumbs, search, Fit, and zoom are available.
3. **Accounts.**
   - A directory with filters for region, country, sector and status, plus a grid of account cards (name, country, sector, status, AI-processing chip, open items, star count).
   - The **account workspace** page has a header (name, plane badge ACCOUNT_RESTRICTED, AI-processing state, members if allowed) and section tabs: Overview, Engagements, Projects, Decisions, Commitments & actions, Deliverables, Outcomes & stories, Risks, Meetings, and Contacts (members only, opaque refs).
   - Success stories show three outputs: internal, lesson, external. External is locked without customer permission.
4. **Governances.** The 12 governances as cards (use-case count, maturity bar). Opening one shows its use cases as a stage board: Discover, In design, Building, Piloting, Deployed.
5. **Review.** A queue of candidates in your review scope. The detail shows the exact revision, a diff against the previous one, sensitivity flags (R-111), and Approve or Request changes. Self-approval is blocked with the reason shown, and two-person status is visible.
6. **Admin** (platform admin and stewards in their scope).
   - Roles and grants as a readable table (scope × actions × conditions), plus memberships.
   - The platform admin sees structure only.
   - Audit receipts list.

## 4. Drawer (any node or record)

- **Header:** title, kind, plane badge and locked, restricted or NDA badges.
- **Counts:** items, topics or accounts, open, gaps.
- **Facts:** type, status, revision, evidence, owner role, source lineage, sector, AI processing.
- **Actions:** grouped as Collaborate (Comment, Contribute, Edit), Govern (Review, Approve release, Manage members) and Admin (Configure). Each comes from the API `canDo`, and a disabled action shows its reason inline.
- **Top items:** each shows its evidence chip and "Open in source" (disabled in dev).
- **Linked from:** backlinks.
- **Ask this node:** disabled in B1, and dimmed when AI processing is unknown or not allowed.

## 5. Accessibility and responsive

- Every map state has a List and Table twin, with full keyboard paths and a visible focus ring in yellow.
- Contrast is AA.
- At 400 px: the rail becomes a bottom tab bar, the drawer becomes a bottom sheet, and the map defaults to List.

## 6. Data contract

The UI calls only `/v1/*`. It never filters for access itself. Whatever the API returns is what the viewer is allowed to see. Locked nodes come with `access: "locked"` and zero counts. Hidden nodes are absent.
