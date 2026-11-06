// Source registry validation. A source maps one SharePoint/OneDrive drive (optionally one folder) to one
// Secondary scope. Everything is validated; anything unexpected is refused.

import { DEFAULT_RETRY, parseRetry } from "../../../packages/contracts/src/ops-v7.ts";
import { NODE_ID, SOURCE_ID } from "./ids.ts";
import type { Provider, SourceDef, SourceScope, SourceSettings } from "./types.ts";

export const DEFAULT_SETTINGS: SourceSettings = {
  chips: [],
  deltaMinutes: 15,
  retry: DEFAULT_RETRY,
  timeoutSeconds: 15,
  aclMaxAgeSeconds: 900,
};
const CHIP = /^[A-Za-z0-9/._ -]{1,60}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 &._()/-]{0,79}$/;

/** The settings a source runs with: what was saved over the defaults. */
export const settingsOf = (s: SourceDef): SourceSettings => ({
  ...DEFAULT_SETTINGS,
  ...s.settings,
});

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

function parseSettings(v: unknown): SourceSettings | string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid_settings";
  const o = v as Record<string, unknown>;
  const out: SourceSettings = { ...DEFAULT_SETTINGS };
  if (o.chips !== undefined) {
    if (!Array.isArray(o.chips) || o.chips.length > 40) return "invalid_chips";
    if (!o.chips.every((c) => typeof c === "string" && CHIP.test(c))) return "invalid_chips";
    out.chips = [...new Set(o.chips as string[])];
  }
  if (o.deltaMinutes !== undefined) {
    const n = int(o.deltaMinutes, 5, 1440);
    if (n === null) return "invalid_schedule";
    out.deltaMinutes = n;
  }
  if (o.retry !== undefined) {
    const r = parseRetry(o.retry);
    if (!r) return "invalid_retry";
    out.retry = r;
  }
  if (o.timeoutSeconds !== undefined) {
    const n = int(o.timeoutSeconds, 1, 120);
    if (n === null) return "invalid_timeout";
    out.timeoutSeconds = n;
  }
  if (o.aclMaxAgeSeconds !== undefined) {
    const n = int(o.aclMaxAgeSeconds, 60, 86_400);
    if (n === null) return "invalid_acl_max_age";
    out.aclMaxAgeSeconds = n;
  }
  return out;
}

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
  let name: string | undefined;
  if (o.name !== undefined) {
    if (typeof o.name !== "string" || !NAME.test(o.name)) return fail("invalid_name");
    name = o.name;
  }
  if (o.paused !== undefined && typeof o.paused !== "boolean") return fail("invalid_paused");
  let rotatedAt: number | undefined;
  if (o.credentialRotatedAt !== undefined) {
    if (typeof o.credentialRotatedAt !== "number" || !Number.isFinite(o.credentialRotatedAt))
      return fail("invalid_rotated_at");
    rotatedAt = o.credentialRotatedAt;
  }
  let settings: SourceSettings | undefined;
  if (o.settings !== undefined) {
    const parsed = parseSettings(o.settings);
    if (typeof parsed === "string") return fail(parsed);
    settings = parsed;
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
      ...(o.paused === true ? { paused: true } : {}),
      ...(name ? { name } : {}),
      ...(settings ? { settings } : {}),
      ...(rotatedAt !== undefined ? { credentialRotatedAt: rotatedAt } : {}),
      createdAt: now,
    },
  };
}
