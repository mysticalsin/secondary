# Graph view

An Obsidian-style graph of the Second Brain at `/graph` on `secondary-api-dev`. Each wiki page is a dot, `[[links]]` between pages are lines, and folders and brains are optional hub nodes. Data comes from the existing `GET /v1/brain/tree` and `GET /v1/wiki/:ws/pages/:pid`, so it shows only what the signed-in person can already read.

`wrapper.template.js` is the Worker's main module. It serves the five files in `client/`, adds a "Graph view" button to the app's HTML pages, and passes every other request to the unchanged app module (`index.js`).

## Preview locally

```bash
node reconstruction/graph/dev/serve.mjs 4317
```

Then open `http://127.0.0.1:4317/graph`. It runs the real wrapper on workerd in front of `dev/fake-app.js`, which serves SYNTHETIC pages only.

## Live deployment

| | |
| --- | --- |
| Deployed | 2026-11-07, version `ba82a43f-9409-4284-92bc-9f4a7a73a9fa`, 100% |
| Previous version (rollback target) | `d94114e9-199c-4842-8854-ddf3a82333b3` (v22) |
| `graph-entry.js` SHA-256 | `2caa054edc85b58be20fb8a770267a7b37b9b22eee97709e8e49322323a0f903` |
| App `index.js` SHA-256 (unchanged from v22) | `62546fddb0910fd6d3eaa5c3b864772d48b6314132657084b3ca76e44c3086d5` |

Bindings, secrets, static assets, and the `v3` Durable Object migration tag were kept. To roll back, deploy the previous version at 100%:

```bash
npx wrangler deployments create secondary-api-dev --version-id d94114e9-199c-4842-8854-ddf3a82333b3
```

A later `wrangler deploy` of the app replaces this wrapper, so the graph has to be re-added after it.
