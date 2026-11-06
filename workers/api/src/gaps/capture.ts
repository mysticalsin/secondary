// Gap signals: a question the brain could not answer (Ask or My Agent ending in "unknown", or a
// search with no result). Called from the places that know the outcome. It never throws and never
// slows the answer: any failure drops the signal.
//
// What is stored, and when:
// - only in a shared brain the asker can open at content level (the view says so; the Personal Brain
//   never holds a signal),
// - only when no personal data is found in the text (R-110): a flagged text is dropped whole,
// - one record per normalised question, with counts, a per-day tally, asker role counts and short
//   hashes of the askers. No person id, no asker text of any other kind.
// A question asked across many brains lands in the brains whose name or collections it mentions
// (at most three), else in Company Global. It never fans out to every brain.

import { opensBrain } from "@secondary/policy";
import { viewOf } from "../auth.ts";
import { type C, sess } from "../ux/util.ts";
import { stubOf, WIKI_NODE_KINDS } from "../uxv2/shared.ts";
import { GAPS_PER_BRAIN, type GapSource, keepable, wordsOf } from "./model.ts";
import { bump, fresh, GAP_KIND, gapIdOf, getGap, putGap, sha } from "./store.ts";

export interface GapTarget {
  param: string;
  nodeId: string;
  scope: string;
  label: string;
}

const MAX_BRAINS = 3;

/** The brains the asker can open at content level, never the Personal Brain. */
function readable(c: C, targets: readonly GapTarget[]) {
  const view = viewOf(sess(c));
  return targets.flatMap((t) => {
    if (t.param === "me" || t.scope.startsWith("personal:")) return [];
    const vn = view.nodes.get(t.nodeId);
    return vn && WIKI_NODE_KINDS.has(vn.kind) && opensBrain(vn) ? [{ t, vn }] : [];
  });
}

export async function recordGaps(
  c: C,
  i: { text: string; targets: readonly GapTarget[]; source: GapSource },
): Promise<void> {
  try {
    const keep = keepable(i.text);
    if (!keep.ok) return;
    const cands = readable(c, i.targets);
    if (!cands.length) return;
    let chosen = cands;
    if (cands.length > 1) {
      const words = new Set(wordsOf(keep.text));
      const hit: typeof cands = [];
      for (const x of cands) {
        const names = new Set(wordsOf(x.t.label));
        const schema = await stubOf(c, x.t.scope).wikiSchema();
        for (const ty of Object.values(schema.types))
          for (const w of wordsOf(ty.label)) names.add(w);
        if ([...names].some((w) => words.has(w))) hit.push(x);
      }
      chosen = hit.length ? hit.slice(0, MAX_BRAINS) : cands.filter((x) => x.vn.kind === "core");
    }
    const s = sess(c);
    for (const { t, vn } of chosen) {
      const stub = stubOf(c, t.scope);
      let id = await gapIdOf(keep.key);
      let g = await getGap(stub, id);
      // A merged gap counts into the one it was merged into.
      if (g?.status === "merged" && g.mergedInto) {
        id = g.mergedInto;
        g = await getGap(stub, id);
      }
      if (!g) {
        if ((await stub.listByKind(GAP_KIND, GAPS_PER_BRAIN)).length >= GAPS_PER_BRAIN) continue;
        g = fresh({ id, text: keep.text, key: keep.key, now: s.ctx.now });
      } else if (g.status === "closed") {
        // It was answered and asked again: the page did not answer it.
        g = { ...g, status: "open", closedAt: null, reopened: g.reopened + 1 };
      }
      const next = bump(g, {
        asker: await sha(`${s.tenantId}:${t.scope}:${s.principal.id}`, 12),
        role: s.principal.roleIds[0] ?? "unknown",
        source: i.source,
        now: s.ctx.now,
      });
      await putGap(stub, next, s.principal.id, vn.plane, s.ctx.now);
    }
  } catch {
    // Dropped: a signal is never worth a failed answer.
  }
}
