# Tasks: In-brain lead decisions

- [x] T001 Red: `harness/tests/lead-decide.test.ts` asserts `acme_lead` on `a_acme` and `c_sales`, denial on `core`, self-approval denial, elevated CEO denial, and no `approve_release` in elevation.
- [x] T002 Only `acme_lead` decides from a standing review, edit, or manage_members grant. Other roles need standing `approve_release`. Direct publish uses that decision. Alias ids, letter case, and reject stay the author's decision. The approve and reject routes pass `authorId`.
