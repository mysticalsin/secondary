// How a stored page is shown to the client: the `LandingDraft` of docs/API-CONTRACT.md, its public URL
// and its counts. Shared by the routes and by the review question.

import { readStats } from "./stats.ts";
import { type LandingDraft, type PageRecord, revisionHashOf, type Stats } from "./types.ts";

/** The base address of the pages worker. Without it nothing can be published: fail closed. */
export const baseUrl = (env: Env): string | null => {
  const b = (env.PAGES_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^\s/]+$/.test(b) && !b.includes("<") ? b : null;
};

export function urlOf(env: Env, rec: PageRecord): string | undefined {
  const b = baseUrl(env);
  if (!b || rec.status !== "published" || !rec.slug) return undefined;
  const q = new URLSearchParams();
  if (rec.utm?.source) q.set("utm_source", rec.utm.source);
  if (rec.utm?.medium) q.set("utm_medium", rec.utm.medium);
  if (rec.utm?.campaign) q.set("utm_campaign", rec.utm.campaign);
  const qs = q.toString();
  return `${b}/p/${rec.slug}${qs ? `?${qs}` : ""}`;
}

export async function toDraft(env: Env, rec: PageRecord): Promise<LandingDraft> {
  const revisionHash = await revisionHashOf(rec);
  const url = urlOf(env, rec);
  return {
    id: rec.id,
    status: rec.status,
    brand: rec.brand,
    lang: rec.lang,
    prospect: rec.prospect,
    slots: rec.slots,
    references: rec.references,
    contact: rec.contact,
    revision: rec.revision,
    revisionHash,
    ...(rec.checks && rec.checks.hash === revisionHash
      ? { checks: { ok: rec.checks.ok, issues: rec.checks.issues } }
      : {}),
    composedBy: rec.composer,
    expiresAt: new Date(rec.expiresAt).toISOString(),
    updatedAt: new Date(rec.updatedAt).toISOString(),
    ...(url ? { url } : {}),
    ...(rec.note ? { note: rec.note } : {}),
  };
}

export async function statsOf(env: Env, rec: PageRecord): Promise<Stats> {
  if (rec.status === "published") return readStats(env, rec.slug);
  if (rec.finalStats) return rec.finalStats;
  return readStats(env, rec.status === "unpublished" ? rec.slug : null);
}
