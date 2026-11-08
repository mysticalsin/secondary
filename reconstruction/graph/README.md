# Graph view and adaptive dashboard

Two read-only views of the Second Brain on `secondary-api-dev`. Both use the existing `GET /v1/brain/tree` and `GET /v1/wiki/:ws/pages/:pid`, so they show only what the signed-in person can already read.

- `/graph`: an Obsidian-style graph. Each wiki page is a dot, `[[links]]` between pages are lines, and folders and brains are optional hub nodes. `/graph#focus=<ws>/<page>` opens with that page selected.
- `/dashboard`: a dashboard that shapes itself around what the brain is about. It scores five lenses (Financial, Business, Consulting & people, Projects & delivery, Knowledge) from the words, folders, amounts, dates, ratings, and feedback in the pages, then shows the top lenses with charts built from that content: money by type and over time, accounts and pipeline, a consultant leaderboard with feedback quotes, a project board, risks and dates, hubs and orphans. Every name opens a side panel with its links, backlinks, mentions, and a "Show in graph" link.

`wrapper.template.js` is the Worker's main module. It serves the files in `client/`, adds "Dashboard" and "Graph view" buttons to the app's HTML pages, and passes every other request to the unchanged app module (`index.js`).

## Preview locally

```bash
node reconstruction/graph/dev/serve.mjs 4317
```

Then open `http://127.0.0.1:4317/dashboard` or `/graph`. It runs the real wrapper on workerd in front of `dev/fake-app.js`, which serves SYNTHETIC pages only (a personal brain, an Acme account brain, and a delivery team brain).

## Live deployment

| | |
| --- | --- |
| Deployed | 2026-11-08, version `c77681da-b393-42d3-88d3-8ef1abb3c6a0`, 100% (graph and dashboard) |
| Previous version (graph only) | `ba82a43f-9409-4284-92bc-9f4a7a73a9fa` |
| Original app version | `d94114e9-199c-4842-8854-ddf3a82333b3` (v22) |
| `graph-entry.js` SHA-256 | `a6c587ad780f0f371a2daf6e45fd45c4c53a5ecdf1a003c7b7e9670bc4b4bb9e` |
| App `index.js` SHA-256 (unchanged from v22) | `62546fddb0910fd6d3eaa5c3b864772d48b6314132657084b3ca76e44c3086d5` |

Bindings, secrets, static assets, and the `v3` Durable Object migration tag were kept. To roll back, deploy an earlier version at 100%:

```bash
npx wrangler deployments create secondary-api-dev --version-id ba82a43f-9409-4284-92bc-9f4a7a73a9fa
```

A later `wrangler deploy` of the app replaces this wrapper, so the views have to be re-added after it.
