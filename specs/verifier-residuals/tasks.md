# Tasks: Verifier residuals

- [x] T000 Spec set. No product code.
- [x] T001 [US1] Red test in `harness/tests/email-identity.test.ts` for U+212A and U+0130. Fails on `6f7aaeae`. Done in `ef41ea8`.
- [x] T002 [US1] ASCII A–Z lowercase in `normalEmail`. T001 passes. Done in `9738333`.
- [x] T003 [US2] Test that a padding-only patch is `invalid` and writes nothing. Guard in `scimUserPatch`. Test `80891b6` passed on the parent because the `@` check already refuses that name. Guard `54f5f82`.
- [x] T004 [US3] Red: `local-boot.test.ts` expects 503 and the not-ready body. Fails while the throw becomes 500. Done in `559c6a9`.
- [x] T005 [US3] `readiness` catches a thrown binding call. T004 passes. Done in `8326740`.
- [x] T006 [US4] Red: two unknown names, two lines, then a repeat with none. Fails while every read logs once. Done in `6e6f02f`.
- [x] T007 [US4] Remember logged names for the isolate. T006 passes. Done in `9acbed0`.
- [x] T008 [US5] Login callback 601 seconds later is 400 and the row is gone. Own commit `5ccd489`. The assertion passed on the parent: `loginStateTake` already deletes an expired row.
- [x] T009 Coverage locks: cookie flags, failed-exchange replay, validated returnTo, SCIM folded name back to back. Done in `1319cde`.
- [x] T010 README counts and the provenance note. Do not change `harness/verify-provenance.ts`.
- [x] T011 Remove the QA shell files from this branch. They move to `cursor/sb-full-fix-qa-b165`. Done in `02808a8`.

## Dependencies

T001 then T002. T004 then T005. T006 then T007. T003, T008, and T009 do not edit the same lines as those pairs. T010 and T011 are last on this branch.
