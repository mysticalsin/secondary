# Tasks: Verifier residuals

- [x] T000 Spec set. No product code.
- [ ] T001 [US1] Red test in `harness/tests/email-identity.test.ts` for U+212A and U+0130. Fails on `6f7aaeae`.
- [ ] T002 [US1] ASCII A–Z lowercase in `normalEmail`. T001 passes.
- [ ] T003 [US2] Test that a padding-only patch is `invalid` and writes nothing. Guard in `scimUserPatch`.
- [ ] T004 [US3] Red: `local-boot.test.ts` expects 503 and the not-ready body. Fails while the throw becomes 500.
- [ ] T005 [US3] `readiness` catches a thrown binding call. T004 passes.
- [ ] T006 [US4] Red: two unknown names, two lines, then a repeat with none. Fails while every read logs once.
- [ ] T007 [US4] Remember logged names for the isolate. T006 passes.
- [ ] T008 [US5] Login callback 601 seconds later is 400 and the row is gone. Own commit.
- [ ] T009 Coverage locks: cookie flags, failed-exchange replay, validated returnTo, SCIM folded name back to back.
- [ ] T010 README counts and the provenance note. Do not change `harness/verify-provenance.ts`.
- [ ] T011 Remove the QA shell files from this branch. They move to `cursor/sb-full-fix-qa-b165`.

## Dependencies

T001 then T002. T004 then T005. T006 then T007. T003, T008, and T009 do not edit the same lines as those pairs. T010 and T011 are last on this branch.
