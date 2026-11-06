// Small helpers shared by the UX routes. They mirror the ones in ../routes.ts (kept local so the
// UX module stays one directory and one mount line).

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { appendReceipt, newReceiptId, type Receipt } from "../audit.ts";
import type { AppEnv, Session } from "../types.ts";

export type C = Context<AppEnv>;

export const MAX_TEXT = 2_000;
export const MAX_BODY_TEXT = 8_000;
export const NODE_ID = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;

export const bad = (code: string, status: 400 | 404 | 409 | 422 = 400) =>
  new HTTPException(status, { message: code });
export const notFound = () => new HTTPException(404, { message: "not_found" });
export const sess = (c: C): Session => c.get("session");
export const forbidden = (c: C, reason: string) => c.json({ error: "forbidden", reason }, 403);

export async function readObject(c: C): Promise<Record<string, unknown>> {
  const raw = await c.req.text();
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw bad("invalid_json");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("invalid_json");
  return v as Record<string, unknown>;
}

export const text = (v: unknown, min: number, max: number, code: string): string => {
  if (typeof v !== "string") throw bad(code);
  const t = v.trim();
  if (t.length < min || t.length > max) throw bad(code);
  return t;
};
export const optText = (v: unknown, max: number, code: string): string | undefined =>
  v === undefined || v === null ? undefined : text(v, 0, max, code);

export const revisionOf = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw bad("revision_required");
  return v;
};

/** A receipt with identity and ids only, never content. False means the audit worker refused it. */
export async function audit(
  c: C,
  i: {
    action: string;
    nodeId: string | null;
    scopeId: string | null;
    revision: number | null;
    decision?: Receipt["decision"];
    reason?: string;
    /** v7 brain rules: the deciding rule (`ruleId@version`), its mode and the replayable metadata. */
    rule?: Receipt["rule"];
    ruleMode?: Receipt["ruleMode"];
    meta?: Receipt["meta"];
  },
): Promise<boolean> {
  const s = sess(c);
  return appendReceipt(c.env, {
    receiptId: newReceiptId(),
    at: new Date().toISOString(),
    tenantId: s.tenantId,
    principalId: s.principal.id,
    action: i.action,
    nodeId: i.nodeId,
    scopeId: i.scopeId,
    decision: i.decision ?? "allow",
    reason: i.reason ?? "owner",
    revision: i.revision,
    requestId: c.get("requestId") ?? null,
    clientId: s.internal?.clientId ?? null,
    tool: s.internal?.tool ?? null,
    ...(i.rule !== undefined ? { rule: i.rule } : {}),
    ...(i.ruleMode !== undefined ? { ruleMode: i.ruleMode } : {}),
    ...(i.meta !== undefined ? { meta: i.meta } : {}),
  });
}

/** Data-level refusal from a Workspace as an HTTP answer. */
export function failResponse(
  c: C,
  f: { code: string; message: string; currentRevision?: number },
): Response {
  if (f.code === "not_found") return c.json({ error: "not_found" }, 404);
  if (f.code === "conflict")
    return c.json(
      { error: "revision_conflict", currentRevision: f.currentRevision, reason: f.message },
      409,
    );
  return c.json({ error: f.code, reason: f.message }, 409);
}
