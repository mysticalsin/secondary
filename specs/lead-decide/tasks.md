# Tasks: In-brain lead decisions

- [x] T001 Red: `harness/tests/lead-decide.test.ts` asserts `acme_lead` on `a_acme` and `c_sales`, denial on `core`, self-approval denial, elevated CEO denial, and no `approve_release` in elevation.
- [ ] T002 `mayDecide` counts a standing grant and ignores an elevation-only allow. The approve route passes `authorId`.
