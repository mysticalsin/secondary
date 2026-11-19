# Feature Specification: Follow-up residuals

**Feature Branch**: `cursor/sb-followup-r2-b165`

**Created**: 2026-11-18

**Status**: Draft

**Input**: Sentinel residuals and the budget refund on the head after N-A. Not part of PR #4.

## Requirements

- **FR-001**: A failed deny receipt on the action routes and the question deny logs `{ at: "audit_unavailable", action, decision: "deny" }` and stays 403.
- **FR-002**: `personaId` returns null for an address `normalEmail` rejects. The dev persona path answers 401.
- **FR-003**: A switch-off log names the audit outcome `succeeded`, `refused`, or `timed_out`, and the switch status. A timeout does not block the off.
- **FR-004**: The 257th unknown switch name logs `{ at: "kill_switch", reason: "cap" }` once. The set is not stored and is empty after a restart.
- **FR-005**: A seed address that does not fold is not inserted.
- **FR-006**: A refund whose store write returns null stays in one `refund` state. The same delta is tried again. A success is not written twice.
- **FR-007**: `GET /me` adds `emailLabel`. A non-ASCII address is escaped. The stored email is unchanged.

## Stopped

- Wiki job claim stays one atomic SQL update. A pure function in front of a later update would drop the single-statement claim. See the report.
- Member remove when `role` is null already proposes removal and calls `brainMemberRemove` only after an applied change. No contained defect.

## Security & data

**Read**: Deny action name, switch status, seed address, profile email.

**Written**: The warning lines above. No address and no amount. A seed row is omitted when the address does not fold. A refund writes the same delta at most once after a null.

**Forbidden**: No secret, no amount, and no address in the new warnings. Provenance is not stubbed to pass offline.

## Root typecheck

The seed test loads `tenant-policy.ts` through a variable `import(specifier)`. A string-literal import of that file pulls `Env` into the root program and fails with TS2304. The variable import is in the red commit, so every commit in this series typechecks.
