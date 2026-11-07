// One human can hold several principal ids (a dev tester who switches persona, a directory entry and a
// persona under the same address). Two-person rules compare people, not ids (N-01).

import { tenantStub } from "./stubs.ts";
import type { Session } from "./types.ts";

/** Every principal id of the same human as the session's principal, the principal's own id included. */
export const humanIdsOf = (env: Env, s: Session): Promise<string[]> =>
  tenantStub(env, s.tenantId).humanIds(s.principal.id, s.principal.email);
