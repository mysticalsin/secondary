# Spec 015: Residual follow-up

**Feature Branch**: `cursor/sb-residual-followup-b165`

**Input**: What remained after spec 014. Test-only. No product change.

## Extra pin

`src/state/erasure-request.ts` is hashed in `patched-sha256.json`. It is not one of the 117 intake files, so it is not in `PATCHED_RECOVERED`. The pin list is that set plus this extra path.

## Step grammar on read

`decodeErasure` rejects a scope step with a newline, a scope id longer than 128 characters, and a scope id outside the step grammar (including non-ASCII).

## Signed negatives

A rejected internal signature answers `{ "error": "unauthorized" }` and nothing else. It does not spend the nonce. The same nonce with a valid signature is then 200.

## Connector errors

`checkSourceAccess` leaves an id out when the response is not OK, the binding or the secret is missing, the body does not parse, or `allowed` is not strictly true. `forgetSourceAccess` is false unless the connector confirms. An upsert with an invalid body is 400 and writes nothing.
