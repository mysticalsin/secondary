// Gap signals: a question the brain could not answer (Ask or My Agent ending in "unknown", or a
// search with no result). Called from the places that know the outcome. It never throws and never
// slows the answer: any failure drops the signal.
//
// What is stored, and when:
// - only in a shared brain the asker can open at content level (the view says so; the Personal Brain
//   never holds a signal),
// - only in a brain the question was aimed at: the single brain it was scoped to, or, for a question
//   across brains, an account brain whose client the question names. It never falls back to Company
//   Global or to a team brain (H-1),
// - never when the text names another client, an NDA account or a restricted brain than the one it is
//   stored in (a gap is shown to every contributor of that brain),
// - only when no personal data is found in the text (R-110): a flagged text is dropped whole,
// - one record per normalised question, with counts, a per-day tally, asker role counts and keyed
//   hashes of the askers (HMAC under a tenant secret, per brain). No person id (M-1).
// A person records at most CAPTURE_PER_MIN signals a minute and opens at most NEW_GAPS_PER_PERSON
// gaps in one brain; a full brain makes room by dropping its lowest-scored open gap (M-2).

import { CLIENT_ALIASES, opensBrain } from "@secondary/policy";
import { viewOf } from "../auth.ts";
import { tenantStub } from "../stubs.ts";
import { type C, sess } from "../ux/util.ts";
import { stubOf, WIKI_NODE_KINDS } from "../uxv2/shared.ts";
import { keyOf } from "../v8-keys.ts";
import { GAPS_PER_BRAIN, type GapSource, keepable, namesHit, scoreOf } from "./model.ts";
import { bump, fresh, GAP_KIND, gapIdOf, getGap, listGaps, putGap } from "./store.ts";

export interface GapTarget {
  param: string;
  nodeId: string;
  scope: string;
  label: string;
}

const MAX_BRAINS = 3;
export const CAPTURE_PER_MIN = 20;
export const NEW_GAPS_PER_PERSON = 25;

/** The brains the asker can open at content level, never the Personal Brain. */
function readable(c: C, targets: readonly GapTarget[]) {
  const view = viewOf(sess(c));
  return targets.flatMap((t) => {
    if (t.param === "me" || t.scope.startsWith("personal:")) return [];
    const vn = view.nodes.get(t.nodeId);
    return vn && WIKI_NODE_KINDS.has(vn.kind) && opensBrain(vn) ? [{ t, vn }] : [];
  });
}

/** Labels of every client, NDA or restricted brain in the asker's view that is not this brain's own. */
function otherClients(c: C, own: { id: string; account?: string }): string[] {
  return [...viewOf(sess(c)).nodes.values()]
    .filter(
      (n) =>
        n.id !== own.id &&
        (!own.account || n.account !== own.account) &&
        (n.kind === "account" || n.restricted || n.nda),
    )
    .flatMap((n) => [n.label, ...(CLIENT_ALIASES[n.id] ?? [])]);
}

export async function recordGaps(
  c: C,
  i: {
    text: string;
    targets: readonly GapTarget[];
    source: GapSource;
    /** The question was aimed at these targets by the asker (one brain named in the call). */
    scoped?: boolean;
  },
): Promise<void> {
  try {
    const keep = keepable(i.text);
    if (!keep.ok) return;
    const cands = readable(c, i.targets);
    const chosen = (
      i.scoped && cands.length === 1
        ? cands
        : cands
            .filter((x) => x.vn.kind === "account" && namesHit(keep.text, [x.t.label]))
            .slice(0, MAX_BRAINS)
    ).filter(
      (x) =>
        !namesHit(
          keep.text,
          otherClients(c, {
            id: x.t.nodeId,
            ...(x.vn.account ? { account: x.vn.account } : {}),
          }),
        ),
    );
    if (!chosen.length) return;
    const s = sess(c);
    const raw = Number.parseInt(c.env.GAP_CAPTURE_PER_MIN ?? "", 10);
    const limit = Number.isFinite(raw) && raw > 0 ? raw : CAPTURE_PER_MIN;
    const hit = await tenantStub(c.env, s.tenantId).hit(
      `gap_capture:${s.principal.id}`,
      s.ctx.now,
      limit,
    );
    if (hit.limited) return;
    for (const { t, vn } of chosen) {
      const stub = stubOf(c, t.scope);
      const asker = await keyOf(c.env, s.tenantId, s.principal.id, `asker:${t.scope}`);
      let id = await gapIdOf(keep.key);
      let g = await getGap(stub, id);
      // A merged gap counts into the one it was merged into.
      if (g?.status === "merged" && g.mergedInto) {
        id = g.mergedInto;
        g = await getGap(stub, id);
      }
      if (!g) {
        const all = await listGaps(stub);
        const mine = all.filter(
          (x) => x.status !== "merged" && x.askerHashes.length === 1 && x.askerHashes[0] === asker,
        );
        if (mine.length >= NEW_GAPS_PER_PERSON) continue;
        if (all.length >= GAPS_PER_BRAIN) {
          // Make room: the lowest-scored gap nobody has taken on, oldest first.
          const out = all
            .filter((x) => x.status === "open")
            .sort(
              (a, b) =>
                scoreOf(
                  { count: a.count, askers: a.askerHashes.length, lastAt: a.lastAt },
                  s.ctx.now,
                ) -
                  scoreOf(
                    { count: b.count, askers: b.askerHashes.length, lastAt: b.lastAt },
                    s.ctx.now,
                  ) ||
                a.lastAt - b.lastAt ||
                a.id.localeCompare(b.id),
            )[0];
          if (!out) continue;
          await stub.remove(out.id);
        }
        g = fresh({ id, text: keep.text, key: keep.key, now: s.ctx.now });
      } else if (g.status === "closed") {
        // It was answered and asked again: the page did not answer it.
        g = { ...g, status: "open", closedAt: null, reopened: g.reopened + 1 };
      }
      const next = bump(g, {
        asker,
        role: s.principal.roleIds[0] ?? "unknown",
        source: i.source,
        now: s.ctx.now,
      });
      await putGap(stub, next, vn.plane, s.ctx.now);
    }
  } catch {
    // Dropped: a signal is never worth a failed answer.
  }
}
