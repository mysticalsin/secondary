# Spec 012: Source hardening

**Feature Branch**: `cursor/sb-src-hardening-b165`

**Input**: Phase 2. Gap C, the empty personal dashboard, stays out. The seed is not changed.

## Candidate read

`GET /v1/ux/candidates/:id` returns one contribution candidate. The author can read it. A caller whose role carries `configure` can read it. Anyone else, and a missing id, is 404 `{ error: "not_found" }`. `GET /v1/nodes/:id` does not grow a candidate branch.

## Brain directory

`GET /v1/brains` and `GET /v1/brains?scope=all` bound each brain. A workspace that does not answer within the bound comes back as a card with its id and name, `pages: 0`, and `unavailable: true`. The other brains still return. Cards that answer in time do not gain `unavailable`. The existing fields stay.

## Anonymous paths

With no credentials, these are 401 `{ error: "unauthorized" }`:

- `GET /v1/internal///ops/targets`
- `GET /v1/internal/%2Fops/targets`
- `GET /v1//internal`

## Repro script

`docs/auth/mantu-503-repro.mjs` loads a worker only when the argument stays inside this repo. Anything else exits 1 and prints `refused: path is outside the repo`.

## Health

`GET /v1/health` is `{ ok: true }`. It does not include `env` or `version`.
