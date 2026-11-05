# Living Wiki: compounding knowledge, governed (B3)

Sponsor direction (2026-11-05): use the "LLM wiki" pattern and similar projects to make Secondary the best enterprise second brain. Research is in `docs/research/LLM-WIKI-RESEARCH.md`, with sources: Karpathy's LLM Wiki gist, lucasastorian/llmwiki, Astro-Han/karpathy-llm-wiki, Graphiti (Zep), Mem0, Letta, Cognee, Onyx, GraphRAG and LightRAG.

## Idea

Every workspace (Personal Brain, each account, each circle, Company Global) gets a **wiki that the AI keeps up to date and humans govern**. Sources stay immutable. The AI proposes pages, facts and links. People approve them. Knowledge compounds over time, and it never crosses a permission boundary.

None of the open-source projects we reviewed enforces tenant or account isolation. Secondary's value is this pattern **plus** the policy engine.

## Three layers per workspace (Karpathy pattern, adapted)

| Layer | What | Store | Who writes |
|---|---|---|---|
| `raw` | immutable sources: SharePoint SourceRecords, meetings, notes, uploads | Workspace DO + R2 (eu), content hash | connectors and users |
| `wiki` | entity and topic pages: account overview, stakeholder roles (opaque refs), decisions log, commitments, risks, methods, glossary | Workspace DO, versioned, Markdown | the AI proposes, humans approve |
| `schema` | the workspace's page types, required sections and tone rules | Workspace DO config | stewards |

Each wiki also has an `index` (catalogue of pages with one-line summaries, used for retrieval first) and an append-only `log` (every ingest, edit, lint and approval). The log is the audit trail, readable by workspace members only.

## Operations

1. **Ingest (one source to a reviewable diff).**
   - A new or changed source triggers a triage step: does it add anything new? If not, it is logged only.
   - Otherwise the AI drafts page edits as a **diff with a citation on every claim**, pointing at raw source IDs.
   - The diff goes to the workspace review queue. Nothing is published unreviewed.
   - Personal Brain is the exception: the owner may set auto-accept for their own wiki.
2. **Query (index-first).**
   - Retrieval reads the index, then the relevant pages, then the cited raw excerpts. Answers cite pages and sources.
   - Each citation is re-checked against the caller's permissions at query time (Onyx-style).
   - Anything the caller cannot read is dropped, and the answer says "unknown" if needed.
3. **Lint (scheduled, per workspace).**
   - Flags contradictions, orphan pages, broken links, claims whose source changed (hash mismatch), stale claims older than the freshness window, and uncited claims.
   - Each finding becomes a review item.
   - Lint runs under the workspace's own service identity, never a global one.
4. **Dreaming (nightly consolidation).**
   - Proposes merges of duplicate pages, summary refreshes and new cross-links within the workspace.
   - It only proposes and never overwrites, so its output goes to the review queue (Letta-style background agent, governed).
5. **Promote to Global (de-identification).**
   - A reviewed account-wiki lesson can be generalised into a Company Global page.
   - This runs the existing contribution flow: sensitivity flags, contributor acknowledgement, 2 distinct approvers.
   - Promoted pages carry no back-link to the account. The global wiki is never a retrieval source for account answers about that account.

## Facts with time (Graphiti pattern)

- Wiki claims are stored as facts: `subject`, `predicate`, `object`, `valid_at`, `invalid_at`, `recorded_at`, `source_ids[]`, `confidence`, `origin` (human, agent, connector), `verified_by`.
- A contradiction invalidates the older fact (sets `invalid_at`) instead of deleting it, and the history stays visible.
- Agent-derived facts are marked as such and stay "unverified" until a human confirms them. Briefs show unverified facts with a badge.

## Permissions (non-negotiable)

- One wiki per workspace. Links between wikis are allowed only toward Company Global, and a page link is shown only if the viewer can read the target. No cross-account links exist.
- Wiki pages inherit the workspace plane and policy. They are searchable only through admitted-workspace fan-out.
- The AI ingests and drafts with the workspace scope only. Prompts never contain another workspace's content.
- MCP tools:
  - `wiki_search` and `wiki_read` use the caller's scope.
  - `wiki_propose` creates a review item, and only with the `secondary.contribute` scope.
  - No MCP tool approves.

## UI (Mantu brand)

- **Wiki tab** in each account, circle and My Secondary: index, pages, page history (diffs), a "facts over time" timeline, and lint findings.
- **Review queue:** shows ingest diffs, lint findings and dreaming proposals, each with citations and an approve, edit or reject choice.
- **Map:** nodes gain a "wiki health" signal (lint findings, freshness).

## Acceptance tests (positive and negative)

- Ingesting a new synthetic meeting creates a diff in that account's review queue only, and every claim is cited.
- A hostile document cannot cause a diff in another workspace or follow its instructions.
- A contradiction invalidates the old fact, and the history shows both.
- Lint flags a claim whose source hash changed.
- Dreaming proposes but never writes.
- A query from a user without access to a cited source drops that citation.
- Promote-to-global strips the account back-link and needs 2 approvers.
- CEO, admin and auditor never see Personal Brain wikis.
