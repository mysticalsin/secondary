# Feature Specification: One switch table

**Feature Branch**: `cursor/sb-untangle-switch-b165`

**Created**: 2026-11-19

**Status**: Draft

**Input**: Tony approved the three larger untangle refactors ("A, all three", via Jarvis). This slice is the switch table only. Observable behaviour stays as on main `8d8ab548`.

## User Scenarios & Testing

### User Story 1 - One declaration for each kill switch (Priority: P1)

The middleware and the handlers that re-check a kill switch read one table. The table names the switch, the HTTP paths the middleware matches, and the handler keys that re-check it. A new path is added on that row, not in a second list.

**Why this priority**: `contribute` is matched in `GATES` and checked again inside `submitCandidate`. `ai` is matched in `GATES` and passed into `gate()` at each call. The two lists can drift.

**Independent Test**: The switch-gate matrix generated from main `8d8ab548`. Same method, path, switch state, and internal flag give the same status and body.

**Acceptance Scenarios**:

1. **Given** `contribute` is off, **When** `POST /v1/personal/items/:id/contribute` is called, **Then** the response is 503 `{ error: "switched_off", switch: "contribute" }`.
2. **Given** `contribute` is off, **When** the same path is requested without the `/v1` prefix, **Then** the middleware does not answer 503.
3. **Given** an internal call and `mcp` is off, **When** any path is requested, **Then** the response is 503 for `mcp`, even if another switch is also off.

### User Story 2 - Responses that are not the middleware 503 stay (Priority: P1)

Search still omits connector hits. Wiki source checks still treat a switched-off connector as unreadable. A sharepoint routine still answers `{ error: "switched_off" }` and the route still returns 409. A routine ingest still answers the reason string. A personal routine target is still not blocked. `gate()` still answers `ai_disabled` when the switch is off, and the planner still falls through when the gate fails for a reason other than the middleware. The wiki ingest job still reads the switch from the tenant record and still fails closed when that read throws.

**Why this priority**: Those paths do not share the middleware's status or body. Folding them into one 503 would change the product.

**Independent Test**: The same main-pinned matrix, plus the handler conditions that are not path matches.

## Requirements

### Functional Requirements

- **FR-001**: HTTP kill-switch names, middleware path matchers, and handler re-check keys MUST live in one table.
- **FR-002**: `switchGate` MUST keep today's order: an internal call with `mcp` off is 503 `mcp`; otherwise the first matching path row wins.
- **FR-003**: Path matchers MUST stay exactly the current ones, including the `/v1` prefix and the `POST`-only contribute matcher.
- **FR-004**: Handler re-checks MUST keep their current condition and response body. Only the switch name is read from the table.
- **FR-005**: `gate()` and the wiki ingest job MUST stay. The job has no session and reads the tenant switch itself.

### Success Criteria

- **SC-001**: The switch-gate matrix generated from main `8d8ab548` matches the head.
- **SC-002**: `npm test`, both typechecks, and `verify:provenance` pass on the head.

### Key Entities

- **Switch row**: a switch name, an optional HTTP matcher, an optional internal flag, and the handler keys that re-check that name.
- **Off body**: `{ error: "switched_off", switch }` with 503, used by the middleware and by the handlers that already used that body.

## Assumptions

- Consolidating the differing response bodies into that 503 would change behaviour. This slice does not do it.
- The personal-target exemption on a routine run stays at the call site.
- Comment deletion and test deletion are limited to files this slice edits.

## Out of scope

Lead derivation, the `recovered-source` / `src/state` move, and a repo-wide deletion of comments or tests.
