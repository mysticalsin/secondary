# Quickstart: Open low fixes

Parent: `c9417c885fc3f12fdcf5201fa15f0e807d50f05d`. Branch: `cursor/sb-full-fix-b165`. No Cloudflare account, no tunnel, no deploy.

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
npm run typecheck:worker
npm run verify:provenance
```

The login cases are in `harness/tests/oidc-login.test.ts`. The SCIM cases are in `harness/tests/email-identity.test.ts`. The switch case is in `harness/tests/kill-switch.test.ts`.

On the parent, before T002, T004, and T006, those new assertions fail. After those commits they pass. The final `npm test` is 416 plus the new tests, 0 failed.

Addresses and switch names in the tests are synthetic. The runs do not print a cookie state, a code, a nonce, a verifier, or a switch name from the new log line.
