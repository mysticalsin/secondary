# Spec 008: Switch follow-up pins

**Feature Branch**: `cursor/sb-switch-followup-b165`

**Input**: Three Info notes on PR #14. Tests only, unless a test shows a defect in `switches.ts`.

## What the tests pin

- The real `/v1` route table, not a catch-all. `/v1//sources/s1` is 404. `/v1/sources/s1` is 503 when the connector switch is off and 200 when it is on. `/v1/sources/s1//x` is 503 when that switch is off, because the path still starts with `/v1/sources/`, and 404 when the switch is on, because no route matches.
- Four or more trailing slashes on `/v1/genui/plan` and on contribute stay on that switch.
- HEAD on `GET /v1/ai/status` is 503 when the ai switch is off and 200 when it is on, the same status as GET.

## What stays

`switches.ts` is not edited. Publish, the Backlog folder download, the MCP allowlist, and `isImport` stay as they are.
