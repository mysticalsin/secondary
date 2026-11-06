// What the page lens, Who knows, saved searches and the expert-listing choice need from a workspace's
// own Durable Object. LensBase sits between BrainBase and Workspace. Nothing here knows the caller:
// the API decides what the caller may see before it shows any of it.

import { BrainBase } from "../brains/store.ts";
import { GENERATED } from "../wiki/text.ts";

/** One revision of a published page and who stands behind it. */
export interface LensRevision {
  pageId: string;
  revision: number;
  at: number;
  /** The author of the approved proposal, else the actor of the revision. Never a service. */
  who: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  q: string;
  at: number;
}

export const MAX_SAVED = 25;
const SAVED_KEY = "lens_saved_searches";
const OPT_OUT_KEY = "lens_expert_optout";
const SKIP_ACTOR = /^(svc|system):/;

export abstract class LensBase extends BrainBase {
  /**
   * Visible revisions of published, hand-written pages with the person behind each: the author of
   * the proposal that made it, else the actor. Hidden versions and generated pages are left out, and so
   * are service actors (seed, journal). Raw: the API keeps only what the caller may read.
   */
  lensRevisions(limit = 20_000): LensRevision[] {
    const skip = [...Object.keys(GENERATED), "journal"];
    return this.sql
      .exec(
        `SELECT r.page_id AS page_id, r.revision AS revision, r.at AS at,
                COALESCE(i.author_id, r.actor) AS who
         FROM wiki_page_revisions r
         JOIN wiki_pages p ON p.id = r.page_id AND p.status = 'published'
         LEFT JOIN items i ON i.id = r.proposal_id
         WHERE r.hidden_at IS NULL AND p.type NOT IN (${skip.map(() => "?").join(",")})
         ORDER BY r.at, r.page_id LIMIT ?`,
        ...skip,
        limit,
      )
      .toArray()
      .flatMap((r) => {
        const who = r.who as string | null;
        if (!who || SKIP_ACTOR.test(who)) return [];
        return [
          {
            pageId: r.page_id as string,
            revision: r.revision as number,
            at: r.at as number,
            who,
          },
        ];
      });
  }

  /** The latest revision of each page and who stands behind it (null for a service). Raw. */
  lensLastChange(
    ids: string[],
  ): { pageId: string; revision: number; at: number; who: string | null }[] {
    if (!ids.length) return [];
    const last = new Map<
      string,
      { pageId: string; revision: number; at: number; who: string | null }
    >();
    for (const r of this.sql
      .exec(
        `SELECT r.page_id AS page_id, r.revision AS revision, r.at AS at,
                COALESCE(i.author_id, r.actor) AS who
         FROM wiki_page_revisions r LEFT JOIN items i ON i.id = r.proposal_id
         WHERE r.hidden_at IS NULL AND r.page_id IN (${ids.map(() => "?").join(",")})
         ORDER BY r.revision`,
        ...ids,
      )
      .toArray()) {
      const who = (r.who as string | null) ?? null;
      last.set(r.page_id as string, {
        pageId: r.page_id as string,
        revision: r.revision as number,
        at: r.at as number,
        who: who && !SKIP_ACTOR.test(who) ? who : null,
      });
    }
    return [...last.values()];
  }

  /** The text of the published journal pages, newest first. They hold counts and page ids only. */
  lensJournals(limit: number): { id: string; markdown: string }[] {
    return this.sql
      .exec(
        "SELECT id, markdown FROM wiki_pages WHERE type = 'journal' AND status = 'published' ORDER BY id DESC LIMIT ?",
        limit,
      )
      .toArray()
      .map((r) => ({ id: r.id as string, markdown: r.markdown as string }));
  }

  // ---- the person's own choices (kept in their Personal Brain's object) ----

  /** True when this person asked not to be listed as someone who knows a topic. */
  lensOptedOut(): boolean {
    return this.metaGet(OPT_OUT_KEY) === "1";
  }
  lensSetOptOut(optOut: boolean): void {
    this.metaSet(OPT_OUT_KEY, optOut ? "1" : "0");
  }

  lensSaved(): SavedSearch[] {
    try {
      const v: unknown = JSON.parse(this.metaGet(SAVED_KEY) ?? "[]");
      return Array.isArray(v) ? (v as SavedSearch[]) : [];
    } catch {
      return [];
    }
  }
  lensSavedAdd(s: SavedSearch): { ok: true; list: SavedSearch[] } | { ok: false; code: string } {
    const cur = this.lensSaved().filter((x) => x.id !== s.id && x.q !== s.q);
    if (cur.length >= MAX_SAVED) return { ok: false, code: "too_many_saved" };
    const list = [s, ...cur];
    this.metaSet(SAVED_KEY, JSON.stringify(list));
    return { ok: true, list };
  }
  lensSavedRemove(id: string): boolean {
    const cur = this.lensSaved();
    const list = cur.filter((x) => x.id !== id);
    if (list.length === cur.length) return false;
    this.metaSet(SAVED_KEY, JSON.stringify(list));
    return true;
  }
}
