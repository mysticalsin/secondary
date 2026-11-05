# Secondary v4 UI: personal brain plus governance brains (familiar, calm)

Date: 2026-11-05. Plan: Claude Opus. Sponsor: Tony.

**Sponsor direction:**
- Remove Studio. Its "put the brain to work" capabilities (Digest, Landing Page Studio) are removed.
- Make the UI familiar, like the internal Collective Intelligence demo (AI Guild recording, 12:35 to 15:20, reviewed frame by frame).
- **Personal second brains.** Separate **governance brains**: Bid & Pre-sales, Sales, Accounts and the others, which are role-based and **never contaminate each other**.
- People inside a governance push information to it through MCP, with their own rights.
- Use the real Mantu logo, top left.

Only UI patterns were taken from the recording. No names, no content.

## 1. Patterns observed in the reference

- **Light, quiet UI.**
  - White canvas and a light grey sidebar.
  - Purple Mantu wordmark logo top left, with a collapse-sidebar button next to it.
  - A wide search bar ("Search pages in your brains" plus a Search button) at top centre.
  - The user's name and initials avatar at top right.
  - A geometric sans for headings, clean body type, and purple used only for active items and primary buttons.
- **Sidebar, in order:**
  - Home.
  - **Waiting for you** with a yellow count badge.
  - **Private:** My Personal Brain (lock icon).
  - **Shared:** one entry per brain (book icon). The active brain expands inline into its collections, folders and pages.
  - **All brains.**
  - The user, at the bottom.
- **Brain page:**
  - Title.
  - "N people can read · You manage this brain" (personal: "Only you can access this brain").
  - Activity link and the primary button "Members and access".
  - "Import a wiki" and "Trash".
  - **Contents**, introduced by "Collections hold the big sections of this wiki", with New collection and New page buttons.
  - A filter input plus "All types", "Any status" and "Any review" dropdowns.
  - Rows: folder icon, name, "N pages", a "Collection" or "Folder" tag, and a ⋯ menu. Rows expand inline to nested folders. Loose pages sit at the bottom with an Overview or Draft badge and an arrow.
- **Members and access:**
  - "Add a name or Mantu e-mail" plus a role select and an Add button.
  - "Who has access N people": first the Everyone at Mantu row (No access, Can read), then members with initials, name, email and a role dropdown:
    - Can read: open and read every page.
    - Can contribute: write and propose pages.
    - Can manage: members, rules and deleting the brain.
    - Remove access.
  - **Publication:** Review required or Direct publishing, with "N still waiting · Publish them · N needs a review".
  - **Business fields:** which properties are sensitive.
  - **Hidden versions.**
- **Waiting for you:**
  - "Find a review" search.
  - Grouped by brain with counts, and a Select all checkbox.
  - Cards: title, summary, a "Change" or "New page" badge, author and age, and "Review →".
- **Pending proposal:**
  - Inline diff: additions highlighted green, deletions struck through in red.
  - "Change 5 of 14" markers and a "Not seen yet" chip.
  - A sticky footer: "Seen 2 of 14 changes · See every change before you approve", Reject…, and "Approve (12 changes left…)". **Approve stays disabled until every change has been seen.**
- **Settings:**
  - Sections: Profile (from the Microsoft account: email, job title, department, office, country), Your brains, **Agents**, Sign-in and security, Privacy, Appearance, Usage, Members, Pilot access, Journal.
  - **Agents** says "Agents act with your rights and your name". It has tabs for Claude Code, Codex, Dust and Copilot. Each tab shows "Run it, then /mcp and authenticate", the terminal command with Copy, and "Then say to your agent: Help me set up my … wiki" with Copy. The Copilot tab has numbered Copilot Studio steps plus an instructions snippet.
- **Workflow:** most users work through MCP, not the app. Agents write session reports at the end of the day into a Sources › Session reports folder, one sub-folder per person.

## 2. Secondary v4 information architecture

**Sidebar:**
- Home.
- Waiting for you (badge).
- **Private**
  - My Personal Brain (lock, owner only, never shareable).
- **Governance brains.** Only the brains the user can read appear, so nothing leaks.
  - Bid & Pre-sales
  - Sales
  - **Accounts**: expands to the account brains the user is a member of. Each account is its own brain.
  - Delivery
  - Finance (A&F)
  - HR, Legal and Hub Ops
  - IT
  - Marketing & Communication
  - Strategy, Innovation & AI
  - Performance
  - Sustainability
  - Recruitment
  - Business-line brains (Amaris, LittleBig Connection, Eleven VMS, Creative Intelligence) where the role grants them
- Company Global: approved, de-identified knowledge, readable by everyone at Mantu.
- All brains: a directory of what you can see, plus "request access" for brains you can see but not open.
- The user, bottom left. Settings sits behind the user menu.

**Removed from navigation:**
- Studio, Digest and LP. Their code is deleted.
- Map, Today, Accounts, Governances, Review, Routines and Usage as top-level items. Their functions fold into brains, Waiting for you and Settings.
- The radial Company Map is replaced by the familiar brain tree. A brain page may offer an optional "Graph" tab later. Not in v4.

**Home:**
- The search bar.
- "Waiting for you" summary.
- "Your brains", as cards with readers and last activity.
- "Recent changes in your brains".
- "Ask your brains". The existing ask box, with answers that cite sources, sits in a quiet card.

## 3. Isolation rules (non-negotiable, server-enforced; the UI only reflects them)

- Each brain is its own store. A page lives in exactly one brain.
- **No cross-brain links, search hits or citations** reach a user who cannot read the target brain.
- Promoting to Company Global is the only path between brains: de-identified, with two approvers.
- Personal Brain is owner-only. No role (CEO, admin, auditor) can open it, and it cannot be shared.
- Account brains are never readable by "Everyone at Mantu". Bid & Pre-sales cannot see Sales unless the role grants it, and so on. This is the role-based policy that already exists.

## 4. MCP push into governance brains

- The MCP tools are listed below. They act with the user's rights and name.
  - `list_brains`: only the user's brains.
  - `search`, `read_page`.
  - `propose_page` and `propose_change`: they create a pending proposal in that brain, following its publication mode. Agents always go through review in shared brains (security finding M-5).
  - `write_session_report`: goes to a Sources › Session reports › <person> folder in the target brain.
  - `get_brain_guide`.
- **Settings › Agents:**
  - Tabs: Claude Code, Codex, Dust, Copilot, Claude.ai, ChatGPT.
  - The exact per-user command, the "then say to your agent" sentence, and Copy buttons.
  - Live connection status and Revoke.
  - Each brain's "Members and access" page shows who can push through agents (contributors and above).

## 5. Visual tokens (light default, Mantu brand)

| Token | Value |
|---|---|
| Canvas | `#FFFFFF` |
| Sidebar | `#F7F6F9` |
| Hairline | `#E8E6EC` |
| Text | `#1A0033` |
| Muted | `#6B6475` |
| Primary | `#6600AE`, hover `#7F00DA` |
| Badge | yellow `#F8F060` on dark text |
| Diff | additions bg `#E6F6EA` with text `#1E6B34`; deletions `#B42318` struck through |

- Dark mode is available in Appearance, using the existing purple palette.
- **Fonts:** Calibri or Carlito for body, per Brand DNA. Headings use Carlito bold, tight. A mono only for commands.
- **Logo:** the official `logo_main.png` (purple wordmark), with `logo_main_white.png` in dark mode. Height 22 to 24 px, top left. Replace the text tile.
- **Shape:** radius 8 to 10, subtle borders, no heavy shadows, generous whitespace. Feels like Outline, Notion or Linear.

## 6. Acceptance

- The sidebar lists only brains the persona can read. The CEO sees all governance brains but not others' personal brains. Head of Bid sees Bid & Pre-sales plus the account brains linked to bids, and not Sales unless granted.
- The brain page shows collections with counts and inline-expanding folders, matching the reference layout.
- Members and access offers role changes (two-person rule where restricted), and publication mode is policy-bounded.
- Waiting for you shows the review detail with inline diff. Approve stays disabled until every change is seen.
- Settings › Agents has a copy command per host, and an MCP proposal lands in the right brain's waiting list.
- The real Mantu logo shows top left in light and dark.
- axe reports zero violations at 1280 and 400 px. FR/EN.
- No Studio, Digest or LP code or routes remain.
