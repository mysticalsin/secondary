# Secondary UX v2: "ask first, brain second, capabilities on top"

Date: 2026-11-05. Plan: Claude Opus. Sponsor: Tony.
Input: Tony's meeting with Arthur (Agence Mantu second brain, 2026-11-02). It was transcribed locally and only the work content was kept: no personal remarks, and no third-party person names. Earlier references still apply: Mantu Brand DNA, the TOTO OS Mantu Edition look, `docs/DESIGN-WEB.md`.

## 1. What the meeting changes

| Lesson | Consequence for Secondary |
|---|---|
| Collaborators do not want a dashboard. They just ask, in Claude or Dust. Too much on screen scares people. | The default home is a single **Ask** surface. The map, graph and admin become secondary views for stewards and builders. Configured MCP hosts get first-class onboarding. |
| A second brain is well-architected folders and pages, with an `index.md` per folder read first. Answers are better than RAG at a similar token cost. | **Brain** is a calm folder/page explorer (Outline-like): Clients, Projects, Opportunities, Bids, Offers, Expertise, Interactions, Entities, Contacts (restricted). Each folder has an index page. Queries are index-first, as the Living Wiki already does. |
| The brain must live outside any one AI vendor. | Export the brain as portable Markdown folders (index plus pages plus frontmatter), with optional Outline sync later. MCP stays the universal door. |
| Value comes from capabilities built on the brain ("arms and legs"). | A **Studio** area of capabilities that use the brain: Weekly Digest, Landing Page Studio, and later more. Each one is permission-aware and cites its sources. |
| People own what their agents ingest. Routines are user-created, a classifier decides ingest, skip or ask, and humans resolve contradictions ("who is right?"). | **Routines** are owned per user. A **Questions inbox** collects the brain's questions for the human: "ingest this?" and "this contradicts page X, which is right?". These become first-class UI, not buried review items. |
| Token cost matters and should be shown. | **Usage** panel showing tokens per run and per capability, plus the savings from index-first retrieval versus full-context reads. |
| The narrative sells it: "if content is king, context is God", Luhmann's slip box, a brain that grows. | A "brain growing" live graph (new pages and links appearing as ingests land) for demos and the Map view, kept calm and optional. |

## 2. Information architecture (left rail, role-aware)

1. **Ask.** This is home.
   - A large input, plus suggested questions for your role.
   - Answers are GenUI cards (KpiRow, ItemList, AccountSummary, StageBoard and so on) with citations to brain pages, and "unknown" when the brain has no answer.
   - Recent answers are saved to My Secondary.
   - Voice input is a later feature, behind a flag.
2. **Brain.**
   - A folder tree on the left and a reading pane on the right: Notion- or Outline-quality typography, page history, facts timeline, backlinks, images.
   - Personal Brain and Company Brain appear as two roots.
   - Locked folders show their name only, and hidden ones are absent.
3. **Questions.** The human-in-the-loop inbox:
   - Ingest decisions from the classifier: ingest, skip, or "ask me".
   - Contradictions, shown as a side-by-side comparison with a "which is right" choice.
   - Lint findings.
   - Approvals: review and two-person release.
   - A count badge.
4. **Studio**, the capabilities:
   - **Weekly Digest.** Per role and scope, for example "This week in your accounts". Opportunities traced, new leads, commitments due, wins, each linked to pages. Preview in-app, and email draft only (never auto-send, standing rule).
   - **Landing Page Studio.** Personalised client pages from the brain's success stories and case studies.
     - It respects the customer-permission gate: no external use of a client name, logo, quote or metric without a CustomerPermission record.
     - Inline editing, a reference picker, publish to a private preview URL, and an approval before anything is public.
     - Reuse-first: evaluate Arthur's existing LP Studio (Azure repo, offered in the meeting) before building our own (decision D16).
5. **Routines.**
   - My ingestion routines, each with a source, schedule, scope and guardrails.
   - Run history, with what was ingested, skipped or asked, and why.
   - Created through a guided wizard, the same flow as the MCP skill.
6. **Map.** The existing role-scoped radial map, plus the "brain growing" mode. Shown for stewards, executives and builders.
7. **Usage.** Tokens per run and per capability, cost per answer, and index-first savings. Admins see the tenant view; each user sees their own.
8. **Admin.** Unchanged (governance console).

**Defaults by role:**
- Sales and consultants see Ask, Brain, Questions, Studio and My Secondary.
- Stewards add Map and Routines.
- Admins add Admin and Usage.

Every user can reach everything they are allowed to see. Only the default rail order changes.

## 3. Visual direction (Mantu brand, quieter and more premium)

- **Less chrome, more content.** One accent per screen. Generous whitespace. Typography-led like Outline or Linear, in Carlito with clear hierarchy.
- **Palette.** Deep purple surfaces are kept for the shell. Reading panes use a light "paper" mode option, because long reading is easier on light. Mantu yellow is reserved for the primary action and anything that needs you.
- **Motion.** Answers stream in, cards assemble, and the brain graph grows. Reduced-motion is respected.
- **Hard limits.** No dense dashboards by default. A screen holds at most 3 primary blocks. Progressive disclosure everywhere ("show more", drawers).
- **Copy.** The tone of the Five Laws: WOW first, clarity, short sentences.

## 4. Data and API additions (server enforces everything)

- `POST /v1/ask` streams answer events from an index-first query: citations, a GenUI plan, and token usage. It reuses the Living Wiki query, the AI gate and the deterministic fallback.
- `/v1/brain/tree` returns a folder tree for the caller, built from the wiki schema per workspace. Page types map to folders.
- **Questions:** a unified feed over the review, ingest-classifier and lint items, with typed actions.
- **Routines:** CRUD plus run log. The classifier verdict on each candidate (ingest, skip or ask) comes from the deterministic plus AI-gated classifier. Guardrails come from the R-110 and R-111 detectors.
- **Usage:**
  - A token ledger per run, written by the AI processor and every capability.
  - An aggregate view per user and per tenant.
  - An index-first savings estimate: tokens read compared with the full-workspace token estimate.
- **Digest:**
  - Compose a weekly digest per principal from admitted scopes.
  - Preview, plus an email draft through the existing draft rule (never auto-sent).
  - A scheduled job builds the drafts.
- **Landing Page Studio, behind D16:**
  - A page model made of a fixed template, brain-sourced sections and references.
  - The CustomerPermission gate.
  - Publishing to an R2 static page under a review-only private URL. Public publishing needs an approval plus customer permission.
- **Export:** portable Markdown brain export per workspace the caller can read (zip), with index and frontmatter.

## 5. Decisions for Tony

- **D16.** Landing Page Studio: integrate Arthur's existing tool (preferred, reuse-first) or build natively in Secondary?
- **D17.** Is the brain's portable format plain Markdown folders with frontmatter, or a named standard? Verify the "Open Knowledge Format" claim before adopting it. Research is pending.
- **D18.** Weekly Digest: in-app plus email drafts only (recommended), or sent automatically? Sending needs an explicit sponsor decision, per the standing rule.

## 6. Acceptance

- A first-time sales user lands on Ask and gets a cited answer in one step.
- The Brain tree shows only admitted folders.
- The Questions inbox resolves an ingest question and a contradiction.
- The Weekly Digest preview links only to pages the reader can open.
- Usage shows the tokens for the last answer.
- Lighthouse accessibility scores at least 95, and axe reports zero violations.
- At 400 px, Ask and Brain are fully usable.
- Every Studio output passes the CustomerPermission gate.
