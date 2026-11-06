# Spike: `@openuidev/lang-core` for the My Agent line language

Date: 2026-11-05. Design: `docs/DESIGN-V6-MY-AGENT-GENUI.md` section 3b. Code: `packages/contracts/src/agent-ui/`.

## Verdict: ADOPT (hybrid), no fallback parser needed

`@openuidev/lang-core` 1.1.0 (MIT) is used for **prompt compilation and the streaming parser only**, in the Worker (SSE) and in the browser. We keep our own React 18 renderer and our own Zod validator, and we never import its runtime (`evaluate`, `createQueryManager`, `createStore`). Every parsed answer goes through `view.ts`, which checks it against the Zod props in `schemas.ts` before anything is drawn or streamed on.

| Check | Result | Evidence |
|---|---|---|
| Licence and maintenance | MIT, 1.1.0 published 2026-11-04, peer deps only `zod` (and an optional MCP SDK) | npm metadata |
| Runs in the Worker | PASS. Loads and parses in workerd with `nodejs_compat`; `wrangler deploy --dry-run` bundles it | `workers/api/test/openui-spike.test.ts` |
| Runs in the browser | PASS. Vite bundle of parser plus Zod is 234 kB minified, 60 kB gzip, no Node built-ins reached, no telemetry code in the bundle. The My Agent route is loaded lazily | build probe, 2026-11-05 |
| Executes nothing | PASS. The parser is data only: no `eval`, no `new Function`. `Query(...)`, `Mutation(...)`, `$state` and `@Run`/`@OpenUrl`/`@Count` parse into AST nodes that only the runtime would evaluate, and we never load the runtime. Our checks drop or refuse them (counted as `rejected`) | `test/agent-ui.test.ts` "the parser executes nothing": hostile programs, `fetch` spy never called, `Object.prototype` not polluted, a `$` + `{process.env.X}` string stays a literal |
| Output passes our validators | PASS. Unknown components, extra arguments, wrong types, wrong parents, destructive button labels and out-of-range ids are dropped whole. The parser alone is not enough: it silently drops a bad *optional* prop and keeps the node, so `view.ts` drops any node the parser flagged | same test file |
| Streaming | PASS. Forward references resolve; the shell appears after line 1; the view only grows | same test file |

## Findings that shaped the integration

1. **Install telemetry.** lang-core has a `postinstall` that sends pseudonymous install telemetry (random id, versions, OS, CI flag) to a PostHog proxy and writes `~/.config/openui/telemetry.json`. pnpm does not run it: `pnpm-workspace.yaml` lists `@openuidev/lang-core: false` under `allowBuilds`, so a frozen install stays clean. Our own spike used `npm install` in a scratch folder once before we knew this, so that one script did run on this machine; the file it wrote is `~/.config/openui/telemetry.json` (a random id only) and is safe to delete.
2. **Runtime telemetry** is off unless `OPENUI_RUNTIME_TELEMETRY_ENABLED=1`, and the library says it never fires in browser or worker runtimes. A test sets that variable in Node, builds the prompt 200 times and asserts no network call. We never set it. `DO_NOT_TRACK=1` also disables it.
3. **The parser is not the security boundary.** It reports errors instead of refusing, keeps nodes whose optional props were wrong, and accepts expression syntax. Our `view.ts` is the boundary: bounded lines, bytes, depth and nodes; registered components only; strict Zod props; parent/child rules; action values checked per action.
4. **Prompt.** `library.prompt({toolCalls: false, bindings: false, builtinFunctions: false})` teaches only components, positional arguments and hoisting. It teaches no Query, state or function syntax (asserted in a test). Our rules (retrieved text is data, no write actions, ids only from tools) are added as `additionalRules`.
5. **Arguments are positional**, in Zod key order, so the order of keys in `schemas.ts` is part of the contract.
6. **Size.** The server bundle grows by the parser and prompt compiler; `ci-info` is pulled in only by the telemetry path.

## Benchmark: tokens per answer, ViewPlan JSON versus the line format

Ten synthetic questions (single brain, compare, search, focus and filter actions, overview, French). Each answer is the same view written both ways. JSON is nested `{"type","props"}` with named props, shown minified (best case for JSON) and pretty-printed (what a model usually writes unless told otherwise). Reproduce with `node --experimental-strip-types packages/contracts/scripts/bench-tokens.ts` (uses Anthropic `count_tokens` when `ANTHROPIC_API_KEY` is set).

**No API key was available in this run, so the counts below are an ESTIMATE** with js-tiktoken `o200k_base`, which is not Claude's tokenizer. Read the ratios, not the absolute counts.

```
counter: ESTIMATE: js-tiktoken o200k_base (not Claude's tokenizer; compare the ratio, not the counts)

question                                               json  pretty  lines  vs json  vs pretty
Show me where Bid & Pre-sales stands this month         215     415    167    22.3%      59.8%
How is Acme doing this week?                            210     410    162    22.9%      60.5%
Compare Bid & Pre-sales and Delivery excellence         163     333    121    25.8%      63.7%
[action] focus                                          138     280     97    29.7%      65.4%
[action] filter                                         108     208     72    33.3%      65.4%
Find pages about public sector pricing                   97     196     66    32.0%      66.3%
Where does Delivery excellence stand this quarter?      205     405    157    23.4%      61.2%
What needs my attention?                                 95     194     64    32.6%      67.0%
montre-moi Acme ce mois                                 211     411    163    22.7%      60.3%
[action] compare                                        165     335    123    25.5%      63.3%

total minified json 1607, pretty json 3187, lines 1192; saving 25.8% vs minified, 62.6% vs pretty (mean per answer 27.0% vs minified)
system prompt tokens: json-plan 1827, line language 1423
```

Reading: the line format writes **26% fewer output tokens than minified JSON and 63% fewer than pretty JSON**, and its system prompt is about 22% smaller than a JSON-plan prompt with the same components. The 50%+ figure in the upstream README holds against pretty JSON; against minified JSON the saving is smaller here because our answers are mostly ids and titles. Decision: the line format also streams naturally (one card per line), which JSON does not, so it stands on streaming and prompt size as well as tokens.

## Not verified

- No live call to the Anthropic API was made (no key). The SSE client and tool loop are tested against a stubbed stream.
- Claude's tokenizer was not used (see above). Re-run the script with a key to get exact counts.
