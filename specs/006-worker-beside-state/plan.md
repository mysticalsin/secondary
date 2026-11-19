# Plan 006: Worker beside state

**Branch**: `cursor/sb-untangle-folder-b165`

## Steps

1. Pin a few kill-switch answers from main `e8e7ef63`.
2. `git mv` `recovered-source/worker/src` to `src/worker`.
3. Shorten imports that crossed from the old tree into `src/state` and `packages`.
4. Point the worker typecheck, the harness, the boot script, and the intake check at `src/worker`.
5. Apply the six queued notes. No new HTTP answer.

## Security & data

The move reads the same request paths and writes the same responses. No new binding, no secret, no stored field. The kill-switch and auth checks stay the functions they are. Env names are unchanged.

## Behaviour question

None in this slice. Publish still reads `can.decide`. The MCP allowlist and the import body limit still use the raw pathname.
