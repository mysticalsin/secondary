// The one audit receipt contract, shared by workers/api, workers/mcp and workers/audit.
// Pure TypeScript, no runtime dependencies, safe in workerd. Workers import this file by relative path
// (the contracts package root pulls in ajv, which workerd forbids).
// A receipt holds who, what, where and the decision. It never holds content.

export type ReceiptSource = "api" | "mcp";
export type Decision = "allow" | "deny" | "rejected";

/**
 * What a brain rule needs to replay an action later (docs/DESIGN-V7-GOVERN-OPERATE.md section 1):
 * ids and enumerated labels only, never content. Every field is checked against a fixed vocabulary.
 */
export type ReceiptMeta = {
  /** The rule action (`export`, `propose_page`, ...). */
  action: string;
  actor: "human" | "agent" | "connector";
  host: string | null;
  brainId: string | null;
  brainType: "personal" | "team" | "account" | "global" | null;
  flags: string[];
  pages: number | null;
  contract: "allowed" | "unknown" | "not_allowed" | null;
  /** Minutes an agent write grant was limited to, when a rule limited it. */
  expiresAfterMin: number | null;
};

export type Receipt = {
  receiptId: string;
  at: string;
  tenantId: string;
  principalId: string;
  /** Lowercase letters, underscores and dots, for example `approve_release` or `authorize.approve`. */
  action: string;
  nodeId: string | null;
  scopeId: string | null;
  decision: Decision;
  reason: string;
  revision: number | null;
  requestId: string | null;
  /** Set for calls that came through MCP. */
  clientId: string | null;
  tool: string | null;
  /** Policy scope or node ids a call targeted. Ids only. */
  scopeIds: string[];
  resultCount: number | null;
  oauthScopes: string[];
  /** Host of a rejected OAuth redirect URI. */
  redirectHost: string | null;
  /** Stamped by the audit worker from the caller's key. Whatever the sender claims is ignored. */
  source: ReceiptSource;
  /** `ruleId@version` of the brain rule that decided this action (v7). */
  rule?: string | null;
  /** `enforced`: the rule decided. `monitor`: it only would have matched. */
  ruleMode?: "enforced" | "monitor" | null;
  meta?: ReceiptMeta | null;
};

export const RECEIPT_ID = /^rcpt_[0-9a-f-]{36}$/;
export const TENANT_ID = /^[a-z0-9_]{3,64}$/;
export const PRINCIPAL_ID = /^[A-Za-z0-9_.:@-]{1,128}$/;
const ID = PRINCIPAL_ID;
const ACTION = /^[a-z_.]{1,40}$/;
const UUID = /^[0-9a-f-]{36}$/;
const TOOL = /^[A-Za-z0-9_.-]{1,60}$/;
const HOST = /^[a-z0-9.:[\]-]{1,255}$/;
const OAUTH_SCOPE = /^[a-z][a-z0-9_.]{0,59}$/;
const DECISIONS: readonly string[] = ["allow", "deny", "rejected"];
const MAX_LIST = 20;
const RULE_TAG = /^[a-z0-9_-]{1,40}@[0-9]{1,6}$/;
const META_ACTIONS: readonly string[] = [
  "propose_page",
  "propose_change",
  "publish",
  "export",
  "promote_to_global",
  "import",
  "write_session_report",
  "share_view",
];
const META_HOSTS: readonly string[] = ["claude", "chatgpt", "dust", "codex", "copilot"];
const META_FLAGS: readonly string[] = [
  "personal_data",
  "client_name",
  "confidential_field",
  "unsupported_claim",
];

export const newReceiptId = (): string => `rcpt_${crypto.randomUUID()}`;

const str = (v: unknown, re: RegExp): string | null =>
  typeof v === "string" && re.test(v) ? v : null;
/** null stays null, a valid string passes, anything else is undefined (invalid). Absent counts as null. */
const nullable = (v: unknown, re: RegExp): string | null | undefined =>
  v === null || v === undefined ? null : (str(v, re) ?? undefined);
const list = (v: unknown, re: RegExp): string[] | undefined => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_LIST) return undefined;
  return v.every((x) => typeof x === "string" && re.test(x)) ? (v as string[]) : undefined;
};

/** The rule metadata, strictly: unknown keys dropped, every value from a fixed vocabulary. */
function parseMeta(v: unknown): ReceiptMeta | null | undefined {
  if (v === null || v === undefined) return null;
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const action = typeof o.action === "string" && META_ACTIONS.includes(o.action) ? o.action : null;
  const actor =
    o.actor === "human" || o.actor === "agent" || o.actor === "connector" ? o.actor : null;
  const host =
    o.host === null || o.host === undefined
      ? null
      : typeof o.host === "string" && META_HOSTS.includes(o.host)
        ? o.host
        : undefined;
  const brainId = nullable(o.brainId, ID);
  const bt = o.brainType;
  const brainType =
    bt === null || bt === undefined
      ? null
      : bt === "personal" || bt === "team" || bt === "account" || bt === "global"
        ? bt
        : undefined;
  const flags = Array.isArray(o.flags) ? o.flags : o.flags === undefined ? [] : undefined;
  const pages =
    o.pages === null || o.pages === undefined
      ? null
      : Number.isInteger(o.pages) && (o.pages as number) >= 0 && (o.pages as number) <= 1_000_000
        ? (o.pages as number)
        : undefined;
  const c = o.contract;
  const contract =
    c === null || c === undefined
      ? null
      : c === "allowed" || c === "unknown" || c === "not_allowed"
        ? c
        : undefined;
  const exp =
    o.expiresAfterMin === null || o.expiresAfterMin === undefined
      ? null
      : Number.isInteger(o.expiresAfterMin) &&
          (o.expiresAfterMin as number) >= 1 &&
          (o.expiresAfterMin as number) <= 1440
        ? (o.expiresAfterMin as number)
        : undefined;
  if (
    !action ||
    !actor ||
    host === undefined ||
    brainId === undefined ||
    brainType === undefined ||
    !flags ||
    flags.length > META_FLAGS.length ||
    !flags.every((f) => typeof f === "string" && META_FLAGS.includes(f)) ||
    pages === undefined ||
    contract === undefined ||
    exp === undefined
  )
    return undefined;
  return {
    action,
    actor,
    host,
    brainId,
    brainType,
    flags: flags as string[],
    pages,
    contract,
    expiresAfterMin: exp,
  };
}

/**
 * Picks exactly the allowed fields. Anything else in the body is dropped, so content cannot ride along.
 * `source` is an argument, not input: the audit worker passes the source that belongs to the caller's key.
 */
export function parseReceipt(v: unknown, source: ReceiptSource): Receipt | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const receiptId = str(o.receiptId, RECEIPT_ID);
  const tenantId = str(o.tenantId, TENANT_ID);
  const principalId = str(o.principalId, PRINCIPAL_ID);
  const action = str(o.action, ACTION);
  const nodeId = nullable(o.nodeId, ID);
  const scopeId = nullable(o.scopeId, ID);
  const requestId = nullable(o.requestId, UUID);
  const clientId = nullable(o.clientId, ID);
  const tool = nullable(o.tool, TOOL);
  const redirectHost = nullable(o.redirectHost, HOST);
  const scopeIds = list(o.scopeIds, ID);
  const oauthScopes = list(o.oauthScopes, OAUTH_SCOPE);
  const at = typeof o.at === "string" && Number.isFinite(Date.parse(o.at)) ? o.at : null;
  const reason = typeof o.reason === "string" ? o.reason.slice(0, 300) : null;
  const revision =
    o.revision === null || o.revision === undefined
      ? null
      : Number.isInteger(o.revision) && (o.revision as number) >= 0
        ? (o.revision as number)
        : undefined;
  const resultCount =
    o.resultCount === null || o.resultCount === undefined
      ? null
      : Number.isInteger(o.resultCount) && (o.resultCount as number) >= 0
        ? (o.resultCount as number)
        : undefined;
  const rule = nullable(o.rule, RULE_TAG);
  const ruleMode =
    o.ruleMode === null || o.ruleMode === undefined
      ? null
      : o.ruleMode === "enforced" || o.ruleMode === "monitor"
        ? o.ruleMode
        : undefined;
  const meta = parseMeta(o.meta);
  const decision =
    typeof o.decision === "string" && DECISIONS.includes(o.decision)
      ? (o.decision as Decision)
      : null;
  if (
    !receiptId ||
    !tenantId ||
    !principalId ||
    !action ||
    !at ||
    reason === null ||
    !decision ||
    nodeId === undefined ||
    scopeId === undefined ||
    requestId === undefined ||
    clientId === undefined ||
    tool === undefined ||
    redirectHost === undefined ||
    scopeIds === undefined ||
    oauthScopes === undefined ||
    revision === undefined ||
    resultCount === undefined ||
    rule === undefined ||
    ruleMode === undefined ||
    meta === undefined
  )
    return null;
  return {
    receiptId,
    at,
    tenantId,
    principalId,
    action,
    nodeId,
    scopeId,
    decision,
    reason,
    revision,
    requestId,
    clientId,
    tool,
    scopeIds,
    resultCount,
    oauthScopes,
    redirectHost,
    source,
    rule,
    ruleMode,
    meta,
  };
}
