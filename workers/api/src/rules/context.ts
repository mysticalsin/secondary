// What the rules need to know about one action: who acted, in which brain, at what time, and what the
// content looks like. Everything here is derived from ids, enumerated labels and counts. Content is read
// only to set a flag, and only the flag leaves this file.

import type { Org } from "@secondary/policy";
import {
  type AgentHost,
  type AiContract,
  type BrainType,
  brainTypeOf,
  type ContentFlag,
  type RuleContext,
  type ViewNode,
} from "@secondary/policy";
import { detectSensitivity } from "../sensitivity.ts";
import type { Session } from "../types.ts";

const DEFAULT_TZ = "Europe/Paris";

/** The host label of an MCP call, mapped onto the rule vocabulary. Unknown hosts are just "agent". */
export function hostOf(host: string | undefined): AgentHost | null {
  switch (host) {
    case "claude_ai":
    case "claude_code":
    case "claude":
      return "claude";
    case "chatgpt":
      return "chatgpt";
    case "dust":
      return "dust";
    case "codex":
      return "codex";
    case "copilot_studio":
    case "copilot":
      return "copilot";
    default:
      return null;
  }
}

export function actorOf(s: Pick<Session, "internal">): RuleContext["actor"] & { roles: string[] } {
  return s.internal
    ? { kind: "agent", host: hostOf(s.internal.host), roles: [] }
    : { kind: "human", roles: [] };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The moment in the tenant's time zone: 0 is Sunday. A bad zone falls back to the default. */
export function tenantTime(env: Env, now: number): { weekday: number; hour: number } {
  const zone = (env as { TENANT_TIMEZONE?: string }).TENANT_TIMEZONE || DEFAULT_TZ;
  for (const timeZone of [zone, DEFAULT_TZ]) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        hour: "numeric",
        hourCycle: "h23",
      }).formatToParts(new Date(now));
      const wd = DAYS.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
      const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
      if (wd >= 0) return { weekday: wd, hour };
    } catch {
      // try the default zone
    }
  }
  const d = new Date(now);
  return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
}

/** The AI contract of the account behind a brain. Only account brains have one. */
export function contractOf(vn: ViewNode | null): AiContract | null {
  if (vn?.kind !== "account") return null;
  const v = vn.facts["AI use with client"];
  return v === "allowed" ? "allowed" : v === "not allowed" ? "not_allowed" : "unknown";
}

export function brainTypeFor(b: { personal: boolean; vn: ViewNode | null }): BrainType | null {
  return b.personal ? "personal" : b.vn ? brainTypeOf(b.vn.kind) : null;
}

const GENERIC = new Set([
  "group",
  "global",
  "company",
  "holding",
  "the",
  "and",
  "synthetic",
  "bank",
  "labs",
]);

/** Names a client could be called by: its label and its first word. */
export function clientNames(org: Org): string[] {
  const out = new Set<string>();
  for (const n of org.nodes.values()) {
    if (n.kind !== "account") continue;
    out.add(n.label.toLowerCase());
    const first = n.label.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (first.length >= 4 && !GENERIC.has(first)) out.add(first);
  }
  return [...out];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Content flags from the text of a proposal. `personal_data`: the sensitivity detector found an
 * address, a number or a sensitive topic. `client_name`: a client's name appears. `unsupported_claim`:
 * a page of some length states figures and cites no source.
 */
export function flagsOf(text: string, org: Org | null, cites: number): ContentFlag[] {
  const flags: ContentFlag[] = [];
  if (detectSensitivity({ body: text }).length) flags.push("personal_data");
  if (org) {
    const names = clientNames(org);
    const low = text.toLowerCase();
    if (names.some((n) => new RegExp(`(^|[^a-z0-9])${escapeRe(n)}([^a-z0-9]|$)`).test(low)))
      flags.push("client_name");
  }
  if (
    cites === 0 &&
    text.length >= 200 &&
    /\d[\d.,]*\s?(%|€|\$|k\b|m\b|million|euros?)/i.test(text)
  )
    flags.push("unsupported_claim");
  return flags;
}
