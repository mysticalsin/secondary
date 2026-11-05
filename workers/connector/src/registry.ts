// Source registry validation. A source maps one SharePoint/OneDrive drive (optionally one folder) to one
// Secondary scope. Everything is validated; anything unexpected is refused.

import { NODE_ID, SOURCE_ID } from "./ids.ts";
import type { Provider, SourceDef, SourceScope } from "./types.ts";

const DRIVE_ID = /^[A-Za-z0-9!_.-]{3,200}$/;
const SITE_ID = /^[A-Za-z0-9,._-]{3,300}$/;
const OPAQUE = /^[a-z][a-z0-9_:-]{5,95}$/;
const ACCOUNT_ID = /^acct_[A-Za-z0-9_-]{8,80}$/;
const ACCOUNT_CLASSES = new Set([
  "internal_confidential",
  "account_confidential",
  "project_restricted",
  "legal_finance_security_restricted",
  "customer_contract_restricted",
]);
const TEAM_CLASSES = new Set(["internal_confidential", "project_restricted"]);

export type Parsed = { ok: true; def: SourceDef } | { ok: false; error: string };

/** Backslash or any control character. */
const hasBadChar = (s: string): boolean =>
  [...s].some((ch) => ch === "\\" || ch.charCodeAt(0) < 32);

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export function parseSource(id: string, raw: unknown, now: number): Parsed {
  const fail = (error: string): Parsed => ({ ok: false, error });
  if (!SOURCE_ID.test(id)) return fail("invalid_source_id");
  const o = obj(raw);
  if (!o) return fail("invalid_body");
  const provider = o.provider;
  if (provider !== "sharepoint_drive" && provider !== "onedrive_folder")
    return fail("invalid_provider");
  if (typeof o.driveId !== "string" || !DRIVE_ID.test(o.driveId)) return fail("invalid_drive_id");
  let siteId: string | null = null;
  if (o.siteId !== undefined && o.siteId !== null) {
    if (typeof o.siteId !== "string" || !SITE_ID.test(o.siteId)) return fail("invalid_site_id");
    siteId = o.siteId;
  }
  let folderPath = "";
  if (o.folderPath !== undefined && o.folderPath !== "") {
    if (typeof o.folderPath !== "string" || o.folderPath.length > 300)
      return fail("invalid_folder");
    const segs = o.folderPath.split("/").filter(Boolean);
    if (segs.some((s) => s === ".." || s === "." || hasBadChar(s))) return fail("invalid_folder");
    folderPath = segs.length ? `/${segs.join("/")}` : "";
  }
  const s = obj(o.scope);
  if (!s) return fail("invalid_scope");
  const kind = s.kind;
  if (kind !== "account" && kind !== "circle") return fail("invalid_scope");
  const plane = kind === "account" ? "ACCOUNT_RESTRICTED" : "TEAM_RESTRICTED";
  if (typeof s.scopeId !== "string" || !NODE_ID.test(s.scopeId)) return fail("invalid_scope_id");
  if (typeof s.gateNodeId !== "string" || !NODE_ID.test(s.gateNodeId))
    return fail("invalid_gate_node");
  if (typeof s.ownerRef !== "string" || !OPAQUE.test(s.ownerRef)) return fail("invalid_owner_ref");
  const classes = kind === "account" ? ACCOUNT_CLASSES : TEAM_CLASSES;
  if (typeof s.classification !== "string" || !classes.has(s.classification))
    return fail("invalid_classification");
  const scope: SourceScope = {
    kind,
    scopeId: s.scopeId,
    gateNodeId: s.gateNodeId,
    plane,
    classification: s.classification,
    ownerRef: s.ownerRef,
  };
  if (kind === "account") {
    if (typeof s.accountId !== "string" || !ACCOUNT_ID.test(s.accountId))
      return fail("invalid_account_id");
    if (typeof s.subspaceId !== "string" || !OPAQUE.test(s.subspaceId))
      return fail("invalid_subspace_id");
    scope.accountId = s.accountId;
    scope.subspaceId = s.subspaceId;
  } else if (s.accountId !== undefined || s.subspaceId !== undefined) {
    return fail("invalid_scope");
  }
  return {
    ok: true,
    def: {
      id,
      provider: provider as Provider,
      siteId,
      driveId: o.driveId,
      folderPath,
      scope,
      enabled: o.enabled !== false,
      createdAt: now,
    },
  };
}
