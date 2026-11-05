// The v4 sidebar (docs/DESIGN-V4-BRAINS-UI.md section 2): Personal, then the governance brains in a
// fixed order, then Company Global. Built only from brains the caller's view admits at content level,
// so a brain the caller cannot read adds no name, count or placeholder.

import type { BrainCard } from "./shared.ts";

export type NavGroup = "personal" | "global" | "governance";
export type NavItem = BrainCard & {
  group: NavGroup;
  /** The governance's id: its `g_*` id where the use-case governances have one, else the node or "accounts". */
  governanceId?: string;
  /** Accounts only: the account brains the caller is admitted to. */
  children?: BrainCard[];
};

/** [governance id, label, brain node id]. A null node is the Accounts group: its members are account brains. */
export const GOVERNANCE_BRAINS: readonly (readonly [string, string, string | null])[] = [
  ["c_bid", "Bid & Pre-sales", "c_bid"],
  ["c_sales", "Sales", "c_sales"],
  ["accounts", "Accounts", null],
  ["c_delivery", "Delivery", "c_delivery"],
  ["g_af", "Finance (A&F)", "d_af"],
  ["g_hr", "HR, Legal and Hub Operations", "d_hr"],
  ["g_it", "IT", "d_it"],
  ["g_mkt", "Marketing & Communication", "d_mkt"],
  ["g_sia", "Strategy, Innovation & AI", "d_sia"],
  ["g_perf", "Performance", "d_perf"],
  ["g_sus", "Sustainability", "d_sus"],
  ["g_recruit", "Recruitment", "d_recruit"],
  // Business-line brains, where the role grants them.
  ["g_amaris", "Amaris", "d_amaris"],
  ["g_lbc", "LittleBig Connection", "d_lbc"],
  ["g_eleven", "Eleven VMS", "d_eleven"],
  ["g_ci", "Creative Intelligence", "d_ci"],
];

/** Brain ids the nav can show besides account brains, Personal and Global. */
export const NAV_NODE_IDS: ReadonlySet<string> = new Set(
  GOVERNANCE_BRAINS.flatMap(([, , node]) => (node ? [node] : [])),
);

/** Pure: the nav from the cards the caller may open. A governance without a brain for them is omitted. */
export function buildNav(cards: readonly BrainCard[]): NavItem[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: NavItem[] = [];
  const me = byId.get("me");
  if (me) out.push({ ...me, group: "personal" });
  for (const [governanceId, label, node] of GOVERNANCE_BRAINS) {
    if (node) {
      const card = byId.get(node);
      if (card) out.push({ ...card, name: label, group: "governance", governanceId });
      continue;
    }
    const children = cards
      .filter((c) => c.type === "account")
      .sort((a, z) => a.name.localeCompare(z.name));
    if (!children.length) continue;
    const scores = children.map((c) => c.health.score);
    const last = children.map((c) => c.lastActivityAt).filter((x): x is string => x !== null);
    out.push({
      id: "accounts",
      type: "account",
      name: label,
      template: "account",
      readers: 0,
      manages: false,
      restricted: true,
      publication: "review",
      role: "reader",
      pages: children.reduce((n, c) => n + c.pages, 0),
      health: { score: Math.round(scores.reduce((n, x) => n + x, 0) / scores.length) },
      lastActivityAt: last.length ? last.reduce((a, b) => (a > b ? a : b)) : null,
      group: "governance",
      governanceId,
      children,
    });
  }
  const core = byId.get("core");
  if (core) out.push({ ...core, group: "global" });
  return out;
}
