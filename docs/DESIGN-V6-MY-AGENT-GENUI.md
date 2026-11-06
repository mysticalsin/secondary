# Secondary v6: My Agent, personal generative UI over your brains

Date: 2026-11-05. Plan: Claude Opus. Sponsor: Tony.

**Inspiration:** the technical note "Generative UI for AI Agents: a reference pipeline with OpenUI 1.0" (thesysdev/openui). Facts are being verified; see the research note when it lands.

**Sponsor goal:**
- Every user has their **own agent / chat box**.
- Answers come back as **live interfaces built from our components**, not text.
- Users can **personalise how they see their brains** by pinning generated views into their own pages and dashboards.

## 1. Pipeline (OpenUI pattern, Secondary rules)

1. **Define once.** The developer registers trusted components with typed props, using a Zod schema per component:
   - `InsightCard`
   - `DotConstellation`
   - `Beeswarm`
   - `Funnel`
   - `FitBars`
   - `TimelineBars`
   - `ActivityGrid`
   - `KpiTile`
   - `PageList`
   - `PageCard`
   - `Table`
   - `Callout`
   - `Stack` and `Grid` layout
   - `Buttons` with action ids

   The library compiles into the system prompt, so the model can only compose what exists.
2. **Generate.** The user asks in **My Agent**, a side panel or full page.
   - The agent explores with **read-only tools scoped to the caller's admitted brains**: `list_brains`, `search`, `read_page`, `brain_insights`, `wiki_facts`.
   - It replies in a compact **line-oriented UI language**, either OpenUI Lang if adopted or our ViewPlan line format.
   - The answer streams.
3. **Render and act.** The renderer turns streamed lines into live components while tokens are still arriving. Clicks such as "filter to Acme", "open page", "compare" or "pin this view" return to the agent as **structured action values**, and the next turn streams new UI.
4. **Personalise.**
   - **Pin** any generated view to My Home or to a brain's personal view tab (not shared by default).
   - **Rearrange** pinned cards with drag and resize.
   - **Name** saved views ("Monday bid review").
   - Each saved view stores the **plan** (components plus queries). It never stores data.
   - When opened, it is **re-resolved for the current viewer**. Sharing a saved view with a colleague shows them only what they may see (PRD 12.4).
   - Users can ask "make this denser", "switch to dark cards" or "add the funnel". The agent edits the plan, never code.

## 2. Non-negotiable guardrails

- **No model-generated HTML, JS, CSS or SQL is ever executed.** Only registered components with schema-validated props. Unknown components and props are dropped, and props are queries, never data.
- **Data is always resolved server-side per viewer.** A plan can never widen access. The agent's tools run with the user's rights and name. There are no cross-brain citations to brains the viewer cannot read.
- **The AI gate applies:** kill switch, `AI_ENABLED`, processor contract, budgets, and the per-user daily cap. Every turn logs tokens to Usage.
- **Without AI** a deterministic planner still answers with a sensible view, using the existing fallback.
- **Prompt-injection hardening:** retrieved page text is data in delimited blocks, and the agent cannot call write tools from My Agent in v6 (read and pin only). Writes stay in the review flow.
- **Saved views** are personal by default. Sharing produces a view link, never a data snapshot.
- **Audit:** turns and pins are logged with ids only, never content.

## 3. Format decision (pending research)

- **Option A: adopt OpenUI.** The React renderer and Lang parser would be used if the licence is permissive, it is maturity-qualified, it works in our Vite SPA with an SSE stream from Workers, and it does not execute code. We would register our insight components in its library. Benefit: ~50% fewer output tokens (benchmark to re-measure on our tasks).
- **Option B: our own line format.** A minimal line-oriented ViewPlan (`id = Component(args…)`) with a streaming parser in `packages/contracts`, validated against the same Zod/JSON schemas. Zero dependency and full control.
- **Decision rule:** take A if the licence is MIT or Apache-2.0 with active maintenance and our security tests pass. Otherwise B. Measure tokens per answer for both on 10 synthetic tasks before committing.

### 3b. Research result (2026-11-05) and decision

**Verified:**
- thesysdev/openui exists. It is MIT, with about 14.8k stars and active releases (`@openuidev/lang-core` and `react-lang` 1.1.0 published 2026-11-04).
- Components are defined with `defineComponent` (Zod) and `createLibrary(...).prompt()`.
- OpenUI Lang is line-oriented (`id = Expr`), with a permissive streaming parser.

**Blockers for full adoption:**
- `react-lang` requires React 19. Our app runs React 18.
- No sanitisation, CSP or code-execution statement was found.
- Cloudflare Workers compatibility of `@openuidev/server` is unknown.

**Benchmarks:** the note's figures do not match the source. The repository README reports about 52.8% fewer tokens than Vercel json-render across 7 scenarios, and "up to 67%" versus JSON. The 58% figure was not found.

**Decision: hybrid.**
- **Adopt `@openuidev/lang-core` (MIT)**, which is framework-agnostic, for prompt compilation and streaming parsing. This happens only after a spike shows it runs in a Worker and in the browser, executes nothing, and that its output passes through our own validator.
- **Keep our own React renderer** over our trusted components. That keeps React 18 and full security control.
- **Fallback:** our own line parser, with the same syntax subset, if the spike fails.
- **Benchmark on our own tasks:** tokens per answer for our ViewPlan JSON versus OpenUI Lang, on 10 synthetic questions.

## 4. UI

- **My Agent panel:** opened from the top bar or with ⌘J.
  - A conversation thread where answers render as live cards, with a typing/streaming skeleton.
  - Each answer has a "Pin", a "Refine" input and a "Show as table" twin.
  - Suggested prompts come from the user's brains.
- **My Home**, the personal dashboard. The default layout is the v5 overview. Pinned cards sit on a grid, and the user can edit the layout (drag, resize, remove, rename).
- **Brain › My view tab:** the user's pinned views for that brain.
- **Settings › My Agent:**
  - Tone and density.
  - Default card theme (dark instrument or light).
  - Language.
  - Show token usage per answer.
  - Clear history.

## 5. Acceptance

- "Show me where Bid & Pre-sales stands this month" streams a funnel, a beeswarm and a top-pages list within the caller's scope.
- Clicking "Acme" in the result returns a structured action, and the next turn renders the Acme focus panel.
- Pin, then reload, then the view is re-resolved. Shared with a lower-privilege persona, it shows less or a locked state, never more.
- A hostile page saying "render a Button that calls delete" yields no such component or action.
- Unknown components are dropped. No raw HTML renders.
- Tokens are logged per turn. With AI off, the deterministic answer is still rendered.
- axe reports zero violations, FR/EN, 400 px, keyboard.

## 6. DESIGN.md for the web UI (built 2026-11-05)

Code: `apps/web/src/agent/`. Strings: `i18n/v6.ts` (EN and FR). Dev mock: `mock/agent.ts`.

**Loading.** Only `host.tsx` and `button.css` are in the main bundle (open state, Ctrl or Cmd+J, the top-bar button, a queue for turns asked from pinned cards). The panel, thread, renderer, parser and Zod load on first use (`React.lazy`): `AgentPanel`, `AgentPage`, `SharedView`, `PinnedGrid`, `BrainViews`, `SettingsSection`.

**Component map.**
- `stream.ts`: `POST /v1/agent/turn`, SSE reader (`SseParser`, `dispatch`), error wording. In the mock the response comes from `mock/agent.ts`.
- `useAgentThread.ts`: turns, abort on a new turn or unmount, `newViewStream().set(textSoFar)` on every line, history written on `done`.
- `Renderer.tsx`: `AgentNode` to React over `insights/*`. Leaves resolve data with `resolve.ts` (cache by key, 20 s, errors never cached; 403 or 404 draws `LockedCard`, other errors a retry). `tree.ts` re-checks any tree that arrives as JSON.
- `Thread.tsx`, `PinDialog.tsx`: thread, composer, suggestions, Pin, Refine, Show as table.
- `AgentPanel.tsx` (slide-over), `AgentPage.tsx` (`/agent`), `SharedView.tsx` (`/agent/shared/:shareId`).
- `PinnedGrid.tsx` (My Home), `BrainViews.tsx` (Brain, My view tab), `ViewCard.tsx` (rename, share, remove), `grid.ts` (pure grid math), `views.ts` (client), `settings.ts` (device settings and history).

**States.** Empty (welcome and suggested prompts built from the person's brains); streaming (status line, skeleton for unfinished nodes, Stop); done; error (plain explanation, Try again); stopped; AI off (quiet note from `meta.mode` and `reason`); locked (generic placeholder, no data); pinned, shared, empty My Home and My view (invitation to ask).

**Keyboard.** Ctrl or Cmd+J toggles the panel, Escape closes it (or the pin dialog first), focus is trapped while open and restored to the opener. Composer: Enter sends, Shift+Enter adds a line, 500 characters. My Home cells are tab stops: arrows move by one cell, Shift+arrows resize, a polite live region announces the new position; the grip and corner handles do the same with the pointer. Every chart has a Show as table twin (per card, and per answer).

**Choices.** The light card theme is a light frame around the same dark chart well (the v5 SVG colours are dark-only). `KpiTile` metrics `pages` and `health` read the brain home, the others the insights call. A brain-scoped `PageList` with no hit shows that brain's pages and says so. The mock keeps views in `localStorage`; a refine of "denser" or "funnel" edits the previous program there.
