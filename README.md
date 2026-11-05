# Secondary

Secondary is a code name (trademark check pending) for an account-scoped second brain for consulting account teams.
It keeps each customer account in its own boundary, with subspaces for general, contacts and restricted commercial material.
Every read goes through a single policy decision point that denies by default.
Slice 1 runs on synthetic data only and targets one internal Amaris account team.
Hosting is undecided (Cloudflare or Azure), so no hosting-specific code exists yet.

Docs and spec (read-only from this repo, not copied here):
`/Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/Chief of Staff/Apps Source/SecondBrain Amaris/docs/phase-1/`
Start with `ROADMAP.md` and `CHALLENGE_REPORT.md`.

## Run

Requires Node from `.nvmrc` and pnpm (see `packageManager` in `package.json`; `corepack enable` does it).

```sh
pnpm install
pnpm test        # vitest, all packages
pnpm lint        # biome
pnpm typecheck   # tsc --noEmit
pnpm --filter @secondary/fixtures generate:sample   # writes packages/fixtures/out and sample
```

## Layout

- `packages/fixtures`: seeded synthetic data generator (tenants, accounts, people, docs, meetings, canary tokens, hostile docs).
- `_relay/HANDOFF.md`: current state and next steps for the next agent or human.
