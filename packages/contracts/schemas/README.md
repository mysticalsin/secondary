# Internal contracts v1.2 (errata, PROPOSED)

Draft 2020-12. Shared definitions: `common.schema.json` (referenced as `common.schema.json#/$defs/...`; load it before the others). All schemas use `additionalProperties: false`.

- Original six, patched: audit-event, export-manifest, global-payload, mutation-intent, task-grant (versions `/2`), plus view-plan.
- Account model, patched: account-workspace, account-knowledge-record, account-success-story, account-relationship.
- New for Slice 1: source-record, revision-manifest, membership, policy-decision, meeting, decision, action, customer-permission, event-envelope.
- `example-manifest.json` lists every example with the expected result and, for invalid ones, the text the validator error must contain.

Revision type is an integer everywhere. Business classification and personal-data state are separate fields. These schemas define shapes only. They do not enforce authentication, authorization, source ACLs, anonymization, GDPR compliance, customer permission or safe publication; the server-side policy service does, and `../backlog/slice1-tests.md` tests it.

`view-plan.schema.json` is not the v1.2 layout schema: it is the GenUI ViewPlan v1 from `docs/API-CONTRACT.md` (catalog components, props are queries only). The v1.2 `view-plan/2` examples were dropped with it.
