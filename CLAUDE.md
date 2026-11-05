# CLAUDE.md (agents working in this repo)

## Roles

- Opus plans: sprint plans, threat model, architecture decisions, review of security-sensitive diffs. Opus does not edit product code.
- Sonnet implements: code, tests, docs, fixtures. One task per subagent, one owner for schemas and migrations.
- Haiku researches: version checks, doc lookups, license scans. Read-only.
- Agents never approve and never merge. Approval, merge to main and real-data activation belong to named humans.

## Data rules

- Synthetic data only. Use `packages/fixtures`.
- The personal vault and anything under `_brain_api/` are banned as fixtures or test input. A guard test enforces this for the generator.
- No personal data about people in code, fixtures, logs or commits. Personal conversations from transcripts are excluded from storage. Anything a user sends or shares must be validated by them, with possible sensitive content flagged. A Vitest guard scans generated output and the committed sample for non-`example.invalid` emails and phone numbers; `personal-segments.json` labels the personal transcript segments for later exclusion tests.
- No secrets in any file, log or chat. Keys by name only. `.env*`, `*.pem`, `*.key`, `.dev.vars` stay out of git.
- Do not push, add remotes or publish without an explicit instruction from Tony.

## Engineering rules

- Simplicity first. No empty placeholder packages. No hosting-specific code until decision D4 is made; keep domain code behind a storage interface.
- TypeScript strict, Biome for lint and format, Vitest for tests. Scripts run TypeScript directly on Node (type stripping), so use `.ts` import extensions and avoid enums.
- Fail closed: unknown principal, account or subspace means deny.
- Evidence before "done": run `pnpm test`, `pnpm lint`, `pnpm typecheck` and show the output. A requirement status changes only with evidence (PASS, FAIL, BLOCKED, NOT_RUN).
- Prose has no em dashes. Conventional commit messages.
- At the end of a session, update `_relay/HANDOFF.md`.
