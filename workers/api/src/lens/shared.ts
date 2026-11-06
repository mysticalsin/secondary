// Shared by the lens, Who knows, search and pulse routes: the brains the caller reads, and the people
// behind revisions. One rule runs through all of it: a person who opted out of expert listing is never
// named, and a page, link or count that comes from a brain the caller cannot read is never produced.

import type { BrainRole } from "@secondary/policy";
import { admittedBrainParams, type Brain, brainOf } from "../brains/open.ts";
import { type Seen, seeBrains } from "../brains/shared.ts";
import { humanIdsOf } from "../human.ts";
import { personalScope } from "../scope.ts";
import { tenantStub, workspaceStub } from "../stubs.ts";
import { type C, sess } from "../ux/util.ts";

export const DAYMS = 86_400_000;

/** "ada.lovelace@x" gives "Ada Lovelace". */
export function nameOfEmail(email: string): string {
  const words = (email.split("@")[0] ?? "").split(/[._+-]+/).filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** A readable name for a principal id when the directory has no address for it. */
const nameOfId = (id: string): string =>
  id
    .replace(/^u_/, "")
    .replace(/_[0-9a-f]{6,}$/, "")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || "Someone";

export interface Person {
  id: string;
  name: string;
}

interface Standing {
  person: Person;
  humanIds: string[];
  optedOut: boolean;
}

const standings = new WeakMap<object, Map<string, Promise<Standing>>>();

/** Name and listing choice of a principal. Looked up once per request. */
export function standingOf(c: C, principalId: string): Promise<Standing> {
  const key = c.req.raw;
  let m = standings.get(key);
  if (!m) {
    m = new Map();
    standings.set(key, m);
  }
  const hit = m.get(principalId);
  if (hit) return hit;
  const s = sess(c);
  const run = (async (): Promise<Standing> => {
    const tenant = tenantStub(c.env, s.tenantId);
    const email = await tenant.emailOfPrincipal(principalId);
    const humanIds = await tenant.humanIds(principalId, email ?? "");
    // Any id of the same human that opted out counts for all of them.
    const flags = await Promise.all(
      humanIds
        .slice(0, 8)
        .map((id) => workspaceStub(c.env, s.tenantId, personalScope(id)).lensOptedOut()),
    );
    return {
      person: { id: principalId, name: email ? nameOfEmail(email) : nameOfId(principalId) },
      humanIds,
      optedOut: flags.some(Boolean),
    };
  })();
  m.set(principalId, run);
  return run;
}

/** The role a person holds in a brain: their stored role, else contributor (they have contributed). */
export async function roleIn(c: C, b: Brain, principalId: string): Promise<BrainRole> {
  const st = await standingOf(c, principalId);
  return (await b.stub.brainRoleOf(st.humanIds)) ?? "contributor";
}

/** The brains the caller reads at content level, as `seeBrains` sees them. Personal only when asked. */
export async function readableBrains(c: C, opts: { personal: boolean }): Promise<Seen[]> {
  const humanIds = await humanIdsOf(c.env, sess(c));
  const params = admittedBrainParams(c).filter((p) => opts.personal || p.param !== "me");
  const brains = (await Promise.all(params.map((p) => brainOf(c, p.param, humanIds)))).filter(
    (b): b is Brain => b !== null,
  );
  return seeBrains(c, brains);
}

export const ageDays = (now: number, at: number): number =>
  Math.max(0, Math.floor((now - at) / DAYMS));

/** Text from a request, on one line: control characters become spaces. */
export const clean = (s: string, max: number): string => {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += code < 32 || code === 127 ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, max);
};
