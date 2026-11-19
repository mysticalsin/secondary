# Spec 013: Dashboard and Graph open on Home's brains

**Feature Branch**: `cursor/sb-dashboard-graph-brains-1c66`

**Input**: Jarvis ruled option (a), with no seeding. Dashboard and Graph open on the same brains Home lists, defaulting to the first admitted brain that has pages. My Secondary stays one choice. They must not open on an empty personal brain or on "All brains" when an admitted brain has pages. The honest empty state stays for when there really are no pages.

## What the current client sends

Dashboard (`deploy/graph/dashboard.js.txt`) and Graph (`deploy/graph/app.js.txt`) both call `GET /v1/brain/tree` with no query string. They do not send `root=personal`.

`GET /v1/brain/tree` treats a missing `root` as both personal and company workspaces (`src/worker/uxv2/tree.ts`). `root=personal` would be personal only. `root=company` would be the non-personal workspaces plus locked name-only nodes. The option labeled "All brains" has `value=""`. It does not send another request. It is a client filter over the tree already loaded, so company roots are already included.

The opening bug is that filter. Both pages select `""` first, and the static markup starts on "All brains". When My Secondary has no pages and another admitted brain does, the page still opens on that union (or on the empty personal view the union includes) instead of the brain that has pages.

Home's list is `GET /v1/brains` with no `scope=all` (`src/worker/brains/routes.ts`). Cards are the admitted brains, `me` first, then name. The personal card is `{ id: "me", name: "My Secondary" }`. `pages` is the visible page count. Tree workspace ids are the same params (`"me"` or the node id).

## What changes

Both pages fetch `GET /v1/brains` and `GET /v1/brain/tree` (still with no `root`). The dropdown options are those cards, in that order, using `name` and `id`. There is no "All brains" option. The selected id is the first card with `pages > 0`, otherwise the first card. My Secondary is present whenever the list includes it.

The empty copy stays, and it is shown only when the selected brain has no pages. That is the case when every admitted brain has `pages === 0`, and when the list itself is empty. An empty `/v1/brains` list does not show the pages from the tree and does not label the view "All brains".

No wiki pages are seeded. The API stays as it is: the tree already returns company roots when `root` is omitted, and `/v1/brains` already returns the Home list.

## What stays

Page bodies, the graph drawing, and the dashboard sections stay. Switching the dropdown still filters the tree already loaded. Auth failures still surface the same sign-in copy. Provenance-pinned Worker source stays untouched.

## Independent test

A Node test loads `dashboard.js.txt` and `app.js.txt` against a fake `fetch`. With My Secondary at 0 pages and Delivery at 2, both selects equal Delivery, the options equal the `/v1/brains` cards (including My Secondary), and the tree request has no `root`. With every card at 0 pages, both selects equal My Secondary and the empty copy is shown. The same assertions fail on the previous "All brains" default.
