# Secondary v3: brains, beyond the internal reference

Date: 2026-11-05. Plan: Claude Opus. Sponsor: Tony.

**Input.** Recording of the 2026-10-29 AI Guild session, from 12:35 onward. It contains a demo of the internal Mantu "Collective Intelligence" LLM-wiki platform, plus a screenshot of its Agents settings. Only product patterns were taken from it: no names, no content.

## 0. Positioning (read first)

An internal Mantu product with the same core already exists and is in pilot. It has:
- Personal and shared brains.
- MCP onboarding for Claude Code, Codex, Dust and Copilot.
- Review queues, collections, import, and a journal.

Duplicating it would go against our own reuse-first rule. So Secondary v3 does three things:

1. **Interoperates.**
   - OKF import and export, so a brain can move between the two platforms with no lock-in.
   - The same MCP door. A user can have both connected without conflict.
2. **Differentiates** where our PRD is unique:
   - Account-centric governance: Account Restricted, NDA named grants, a contacts subspace, customer-permission gates.
   - The role-based see/do model with two-person rules.
   - The temporal facts wiki (contradictions, lint, dreaming).
   - Studio capabilities: Digest and Landing Page Studio.
   - The Company Map and GenUI.
   - Enterprise ops: audit, GDPR, kill switches, backups.
3. **Adopts the reference's proven UX patterns** where they beat ours, then goes further.

**Sponsor action (D19).** Talk to the Collective Intelligence owners about a joint roadmap. For example, Secondary could become the account and commercial governance layer and capabilities layer on top of shared brains. This is a business decision, not a code one.

## 1. Patterns adopted, then pushed further

| Reference pattern | Secondary v3 (further) |
|---|---|
| **Brains: personal and shared.** Personal is truly private with no sharing at all, plus an "All brains" directory. | **Brains are the unit everywhere.** Personal, Team (circles), Account and Company Global are all "brains" in one consistent UI. The directory shows only admitted brains, with type chips (Personal, Team, Account, Global) and a health score. A brain created from a template gets the right collections. |
| **Brain home.** Readers count, "You manage", Activity, Import, Trash, collections with counts, filters by type, status and review. | The same, plus:<br>• A **brain health strip:** freshness, lint findings, orphans, review backlog, coverage of key collections.<br>• **"What changed this week"** with diffs.<br>• **Structure coach suggestions**, for example "8 pages in Sources look like Projects. Move them?" |
| **Access per brain.** Everyone-at-company level, member roles, Publication mode (review required or direct). | Roles mapped to our see/do model: Reader, Contributor, Editor, Steward, Owner.<br>• Publication mode per brain is **policy-bounded**. Account, Restricted and Global brains force "Review required". Personal and team brains may choose direct publishing.<br>• "Everyone at Mantu" is never allowed on Account or NDA brains.<br>• Changes to restricted brains go through the existing two-person rule. |
| **Business fields** (which page properties are sensitive). | A **typed schema per brain**: fields, types, sensitivity (none, confidential, personal) and retention. It drives masking, the R-110 and R-111 detectors, the export filter and the AI-processing gate. |
| **Hidden versions.** | Page history with hide and restore, audited. Erasure stays separate and two-person. |
| **Waiting for you.** Search, select all, Change and New page badges. | The Questions inbox gains search, filters (brain, kind, age), **batch review** (approve several at once only where the two-person rule allows it, else per item), and keyboard triage (J/K, A approve, R request changes). |
| **Agents settings.** Tabs for Claude Code, Codex, Dust and Copilot with a copy command, plus "say this to your agent". | Tabs for **Claude Code, Claude.ai, ChatGPT, Codex, Dust and Copilot Studio**:<br>• An exact per-user command (client id, callback port, URL) with a Copy button.<br>• Step-by-step instructions for UI hosts.<br>• An "instructions for your agent" snippet.<br>• A **live connection status** for each host (last call, scopes granted) and a revoke button. |
| `get_wiki_guide` plus an agent that helps people structure their wiki. | An **MCP `get_brain_guide`** tool, plus a **Structure Coach**:<br>• Interviews the user (role, accounts, recurring work).<br>• Proposes a collection tree from templates (Account brain, Bid brain, Practice brain, Personal).<br>• Creates it on approval.<br>• Later suggests reorganisations based on lint. |
| **Journal** (daily session reports). | An automatic **daily journal page per brain**, built deterministically from the wiki log: what was ingested, decided or contradicted, with links. It feeds the digest. |
| **Import a wiki.** | **Import in OKF v0.2, Obsidian vault (zip) and Outline export.** Imported content runs through the classifier, so personal or HR material is skipped or asked about. Every imported page lands as a draft for review in shared brains, or directly in Personal. |
| Usage, Members, Pilot access. | Already present: Usage, the governance console and memberships. Add **pilot cohorts** (invite lists, feature flags per cohort). |

## 2. Beyond the reference (our "1000x")

1. **Account brains with commercial intelligence.** An account page brings together opportunities, bids, commitments, risks, success stories and stakeholder roles (opaque), on a timeline. Ask "where do we stand with X" across the account.
2. **Temporal truth.** Every fact has validity. Contradictions become "which is right?" questions, and the history is visible as a timeline.
3. **Capabilities on top of brains:** Digest, Landing Page Studio, briefs, and later RFP answer drafting from bid brains. All are permission-aware and cite their sources.
4. **Governed GenUI.** Ask answers render as cards. Hosts render them through MCP Apps.
5. **Enterprise by default:** Entra and SCIM, audit, GDPR export and erase, backups, kill switches, EU residency.
6. **Interoperable:** OKF in and out, plus MCP. This makes Secondary the safe place to run an LLM wiki for client-facing work.

## 3. Build plan (after Landing Page Studio merges)

- **WS-A, backend:**
  - Brain model unification (types, templates, readers count, health).
  - Per-brain access with publication mode bounded by policy.
  - Typed business fields with sensitivity.
  - Hidden versions.
  - Batch review rules.
  - Imports (OKF, Obsidian zip, Outline JSON) through the classifier.
  - Daily journal job.
  - `get_brain_guide` and Structure Coach endpoints (template proposal, apply).
  - Agent connection status and revoke.
  - Pilot cohorts.
- **WS-B, web (Mantu brand, premium):**
  - All brains directory.
  - Brain home with health strip and "what changed".
  - Access page.
  - Business fields editor.
  - Hidden versions.
  - Questions upgrades: search, batch, keyboard.
  - Settings > Agents with live status.
  - Import wizard.
  - Structure Coach chat-style wizard.
  - Journal view.
- **Tests:** every policy boundary has a negative test:
  - "Everyone at Mantu" is impossible on account or NDA brains.
  - Direct publishing is impossible where policy forces review.
  - Import never bypasses the classifier or review.
  - The coach can only create collections in brains the user manages.
  - Batch approve respects the two-person rule per item.
