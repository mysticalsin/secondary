// Resolves a browser session cookie to an email. Used by `authenticate` in ../auth.ts.

import { tenantStub } from "../stubs.ts";
import { parseSessionValue } from "./session.ts";

export async function emailFromSession(raw: string, env: Env, now: number): Promise<string | null> {
  const p = await parseSessionValue(raw, env);
  if (!p) return null;
  const r = await tenantStub(env, p.tenantId).sessionValidate(p.hash, now);
  return r ? r.email : null;
}
