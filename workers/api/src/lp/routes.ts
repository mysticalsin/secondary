// /v1/lp/*: Landing Page Studio (docs/DESIGN-LP-STUDIO.md section 2). Mounted once in ../routes.ts, after
// authentication and the kill switch gate. A page belongs to the person who composed it: everyone else
// gets 404, except a reviewer who may decide it (approve). Rules that hold on every route:
//   - the composer sees only what the caller's admitted view allows, and permission is recomputed on the
//     server: the client never says whether a reference may be named
//   - no page is public before an independent approval of the exact revision; MCP has no route that
//     submits, approves or publishes
//   - every change is on the record first (receipt), and a failed receipt stops the action

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { contractGate, gate } from "../ai/brief.ts";
import { doBudget, withUserCap } from "../ai/budget.ts";
import { requireOrg, viewOf } from "../auth.ts";
import { tenantStub } from "../stubs.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { audit, bad, type C, forbidden, notFound, readObject, sess } from "../ux/util.ts";
import { metered, recordUsage } from "../uxv2/ledger.ts";
import { runChecks } from "./checks.ts";
import { composeDeterministic, composeWithAi } from "./compose.ts";
import { Brain } from "./refs.ts";
import { IMAGE_OK, type LandingRenderData, renderLandingPage } from "./render.ts";
import { approvePage } from "./review.ts";
import { deletePage, imageKey, pageKey, readStats } from "./stats.ts";
import { lpStub } from "./stub.ts";
import {
  type Brand,
  type Contact,
  cleanSlot,
  DAY_MS,
  DEFAULT_DAYS,
  hexId,
  isBrand,
  isLang,
  type LandingDraft,
  type Lang,
  MAX_DAYS,
  MAX_REFERENCES,
  type PageRecord,
  type Prospect,
  type Reference,
  revisionHashOf,
  SLOTS,
  type Slots,
  type Stats,
  type Utm,
} from "./types.ts";

const ID = /^lp_[0-9a-f]{16}$/;
const PAGE_REF = /^[a-z0-9][a-z0-9_.:-]{0,127}\/[a-z0-9][a-z0-9-]{0,63}$/;
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const UTM_VALUE = /^[A-Za-z0-9._~ -]{1,60}$/;
const SLOT_HARD_MAX = 2_000;
const COMPOSE_PER_MIN = 30;
const LIST_MAX = 100;

const parseObject = async (raw: string): Promise<Record<string, unknown>> => {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw bad("invalid_json");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("invalid_json");
  return v as Record<string, unknown>;
};

const oneLine = (v: unknown, min: number, max: number, code: string): string => {
  if (typeof v !== "string") throw bad(code);
  const t = v
    .replace(/\p{Cc}+/gu, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length < min || t.length > max) throw bad(code);
  return t;
};

export const nameOfEmail = (email: string): string =>
  (email.split("@")[0] ?? "")
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .slice(0, 80) || "Your contact";

/** The base address of the pages worker. Without it nothing can be published: fail closed. */
const baseUrl = (env: Env): string | null => {
  const b = (env.PAGES_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^\s/]+$/.test(b) && !b.includes("<") ? b : null;
};

/** The data a template gets. Published images are the paths the publish step has just copied. */
export function renderData(
  rec: PageRecord,
  mode: LandingRenderData["mode"],
  images: string[] = [],
): LandingRenderData {
  return {
    brand: rec.brand,
    lang: rec.lang,
    prospect: rec.prospect,
    slots: rec.slots,
    references: rec.references.map((x, n) => {
      const image = mode === "published" ? images[n] : x.image;
      return { title: x.title, summary: x.summary, ...(image ? { image } : {}) };
    }),
    contact: rec.contact,
    mode,
  };
}

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
    ...(url ? { url } : {}),
    ...(rec.note ? { note: rec.note } : {}),
  };
}

export async function statsOf(env: Env, rec: PageRecord): Promise<Stats> {
  if (rec.status === "published") return readStats(env, rec.slug);
  if (rec.finalStats) return rec.finalStats;
  return readStats(env, rec.status === "unpublished" ? rec.slug : null);
}

export function lpRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const now = (c: C): number => sess(c).ctx.now;

  /** The caller's own page, or 404: a page of someone else is not visible. */
  async function owned(c: C): Promise<PageRecord> {
    const s = sess(c);
    requireOrg(s);
    const id = c.req.param("id") ?? "";
    if (!ID.test(id)) throw notFound();
    const rec = await lpStub(c.env, s.tenantId).get(id);
    if (!rec || rec.owner !== s.principal.id) throw notFound();
    return rec;
  }

  /** MCP composes drafts and lists them. Everything past that is a person in the web app. */
  const notMcp = (c: C): Response | null =>
    sess(c).internal ? forbidden(c, "Not available through MCP") : null;

  async function limited(c: C, key: string, max: number): Promise<Response | null> {
    const s = sess(c);
    const res = await tenantStub(c.env, s.tenantId).hit(`lp_${key}:${s.principal.id}`, now(c), max);
    if (!res.limited) return null;
    c.header("Retry-After", String(res.retryAfter));
    return c.json({ error: "rate_limited" }, 429);
  }

  // ---- list ----

  r.get("/lp", async (c) => {
    const s = sess(c);
    requireOrg(s);
    const rows = await lpStub(c.env, s.tenantId).listByOwner(s.principal.id, LIST_MAX);
    return c.json(
      await Promise.all(
        rows.map(async (rec) => ({
          ...(await toDraft(c.env, rec)),
          stats: await statsOf(c.env, rec),
        })),
      ),
    );
  });

  // ---- compose ----

  r.post("/lp/compose", async (c) => {
    const s = sess(c);
    requireOrg(s);
    const b = await readObject(c);
    const p = (b.prospect ?? {}) as Record<string, unknown>;
    if (typeof p !== "object" || Array.isArray(p)) throw bad("invalid_prospect");
    const prospect: Prospect = {
      role: oneLine(p.role, 2, 120, "invalid_role"),
      company: oneLine(p.company, 2, 120, "invalid_company"),
      ...(p.firstName === undefined || p.firstName === null || p.firstName === ""
        ? {}
        : { firstName: oneLine(p.firstName, 1, 60, "invalid_first_name") }),
    };
    const angle = oneLine(b.angle, 2, 300, "invalid_angle");
    if (b.brand !== undefined && !isBrand(b.brand)) throw bad("invalid_brand");
    if (b.lang !== undefined && !isLang(b.lang)) throw bad("invalid_lang");
    const brand: Brand = isBrand(b.brand) ? b.brand : "amaris";
    const lang: Lang = isLang(b.lang) ? b.lang : "en";
    const refused = await limited(c, "compose", COMPOSE_PER_MIN);
    if (refused) return refused;

    const brain = new Brain(c, lang);
    const known = brain.knownAccount(prospect.company);
    const refs = await brain.find({ query: `${angle} ${prospect.role}`, known });
    let slots: Slots = composeDeterministic({ prospect, angle, lang, brand, refs });
    let composer: "deterministic" | "ai" = "deterministic";

    // The AI composer, only through the same gate as every AI path, and only with text that is already
    // safe to show: anonymised references, and none from an account whose contract does not allow AI.
    const g = gate(c.env, s.switches.ai);
    if (g.ok) {
      const view = viewOf(s);
      const ownContract = contractGate(view, known?.id);
      const aiRefs = refs.filter((x) => {
        const ws = x.pageId.split("/")[0] ?? "";
        return view.nodes.get(ws)?.kind !== "account" || contractGate(view, ws) === null;
      });
      if (!ownContract) {
        const ok = await audit(c, {
          action: "lp.ai_compose",
          nodeId: known?.id ?? null,
          scopeId: null,
          revision: null,
        });
        if (ok) {
          const meter = metered(
            withUserCap(
              doBudget(c.env, s.tenantId, now(c)),
              doBudget(c.env, s.tenantId, now(c), `u-${s.principal.id}`),
              g.userDailyBudget,
            ),
          );
          const out = await composeWithAi({
            ai: g,
            budget: meter.store,
            prospect,
            angle,
            lang,
            brand,
            refs: aiRefs,
            accounts: brain.accounts,
            ...(deps.fetch ? { fetch: deps.fetch } : {}),
            ...(deps.sleep ? { sleep: deps.sleep } : {}),
          });
          await recordUsage(c.env, s.tenantId, s.principal.id, now(c), {
            capability: "lp_compose",
            tokens: meter.spent(),
            runs: 1,
          });
          if (out.ok) {
            slots = out.slots;
            composer = "ai";
          }
        }
      }
    }

    if (!(await audit(c, { action: "lp.compose", nodeId: null, scopeId: null, revision: null })))
      return c.json({ error: "audit_unavailable" }, 503);
    const rec = await lpStub(c.env, s.tenantId).create(
      {
        id: `lp_${hexId(8)}`,
        owner: s.principal.id,
        ownerEmail: s.principal.email,
        brand,
        lang,
        prospect,
        slots,
        references: refs,
        contact: { name: nameOfEmail(s.principal.email), email: s.principal.email },
        composer,
        expiresAt: now(c) + DEFAULT_DAYS * DAY_MS,
      },
      now(c),
    );
    return c.json(await toDraft(c.env, rec), 201);
  });

  // ---- read, edit ----

  r.get("/lp/:id", async (c) => c.json(await toDraft(c.env, await owned(c))));

  r.put("/lp/:id", async (c) => {
    const rec = await owned(c);
    const s = sess(c);
    const blocked = notMcp(c);
    if (blocked) return blocked;
    const b = await readObject(c);
    if (typeof b.revision !== "number" || !Number.isInteger(b.revision) || b.revision < 0)
      throw bad("revision_required");
    const rawSlots = b.slots as Record<string, unknown> | undefined;
    if (!rawSlots || typeof rawSlots !== "object" || Array.isArray(rawSlots))
      throw bad("invalid_slots");
    const slots = {} as Slots;
    for (const k of SLOTS) {
      const v = rawSlots[k];
      if (typeof v !== "string" || v.length > SLOT_HARD_MAX) throw bad("invalid_slots");
      slots[k] = cleanSlot(v);
    }
    if (!Array.isArray(b.references)) throw bad("invalid_references");
    if (b.references.length > MAX_REFERENCES)
      return c.json({ error: "too_many_references", max: MAX_REFERENCES }, 422);
    const asked = b.references.map((x: unknown) => {
      const o = x as Record<string, unknown>;
      if (!o || typeof o !== "object" || typeof o.pageId !== "string" || !PAGE_REF.test(o.pageId))
        throw bad("invalid_references");
      if (
        o.image !== undefined &&
        o.image !== null &&
        (typeof o.image !== "string" || !IMAGE_OK.test(o.image))
      )
        throw bad("invalid_image");
      return { pageId: o.pageId, image: typeof o.image === "string" ? o.image : undefined };
    });
    if (new Set(asked.map((x: { pageId: string }) => x.pageId)).size !== asked.length)
      throw bad("duplicate_references");
    const ct = (b.contact ?? {}) as Record<string, unknown>;
    const contact: Contact = {
      name: oneLine(ct.name, 1, 80, "invalid_contact"),
      email: oneLine(ct.email, 5, 120, "invalid_contact"),
    };
    if (!EMAIL.test(contact.email)) throw bad("invalid_contact");

    // What a reference says is the brain's, resolved again as this caller: the client only picks which.
    const brain = new Brain(c, rec.lang);
    const resolved = await brain.resolve(asked.map((x: { pageId: string }) => x.pageId));
    const references: Reference[] = [];
    for (const [i, ref] of resolved.entries()) {
      const want = asked[i] as { pageId: string; image: string | undefined };
      if (!ref) return c.json({ error: "reference_unavailable", pageId: want.pageId }, 422);
      // A visual is kept only on a reference the customer permitted: never a logo of a client we may not name.
      references.push(
        want.image && ref.permission === "named" ? { ...ref, image: want.image } : ref,
      );
    }

    if (
      !(await audit(c, {
        action: "lp.edit",
        nodeId: rec.id,
        scopeId: null,
        revision: rec.revision,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await lpStub(c.env, s.tenantId).update(
      rec.id,
      b.revision,
      { slots, references, contact },
      { id: s.principal.id, email: s.principal.email },
      now(c),
    );
    if (res.ok) return c.json(await toDraft(c.env, res.record));
    if (res.code === "conflict")
      return c.json(
        { error: "revision_conflict", currentRevision: res.currentRevision, reason: res.message },
        409,
      );
    if (res.code === "not_found") throw notFound();
    return c.json({ error: res.code, reason: res.message }, 409);
  });

  r.get("/lp/:id/references", async (c) => {
    const rec = await owned(c);
    const refused = await limited(c, "refs", 60);
    if (refused) return refused;
    const q = (c.req.query("q") ?? "").trim();
    if (q.length > 200) throw bad("invalid_query");
    const brain = new Brain(c, rec.lang);
    const known = brain.knownAccount(rec.prospect.company);
    return c.json(await brain.find({ query: q || rec.prospect.role, known, limit: 12 }));
  });

  // ---- check, review ----

  r.post("/lp/:id/check", async (c) => {
    const rec = await owned(c);
    const s = sess(c);
    const res = await runChecks(new Brain(c, rec.lang), rec);
    await lpStub(c.env, s.tenantId).saveChecks(rec.id, await revisionHashOf(rec), res);
    return c.json(res);
  });

  r.post("/lp/:id/submit", async (c) => {
    const rec = await owned(c);
    const s = sess(c);
    const blocked = notMcp(c);
    if (blocked) return blocked;
    if (rec.status !== "draft")
      return c.json({ error: "locked", reason: "Only a draft can be sent to review" }, 409);
    // The checks run again here, on this revision: a client cannot skip them, and a flag blocks.
    const res = await runChecks(new Brain(c, rec.lang), rec);
    const store = lpStub(c.env, s.tenantId);
    await store.saveChecks(rec.id, await revisionHashOf(rec), res);
    if (!res.ok) return c.json({ error: "checks_failed", ...res }, 422);
    if (
      !(await audit(c, {
        action: "lp.submit",
        nodeId: rec.id,
        scopeId: null,
        revision: rec.revision,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    // The reviewer reads exactly this page: its rendering is stored with the submission.
    const out = await store.submit(
      rec.id,
      rec.revision,
      renderLandingPage(renderData(rec, "preview")),
      now(c),
    );
    if (!out.ok) return c.json({ error: out.code, reason: out.message }, 409);
    return c.json(await toDraft(c.env, out.record));
  });

  r.post("/lp/:id/approve", async (c) => {
    const s = sess(c);
    requireOrg(s);
    const id = c.req.param("id") ?? "";
    if (!ID.test(id)) throw notFound();
    const rec = await lpStub(c.env, s.tenantId).get(id);
    if (!rec) throw notFound();
    const b = await readObject(c);
    if (
      b.revisionHash !== undefined &&
      (typeof b.revisionHash !== "string" || b.revisionHash.length > 128)
    )
      throw bad("invalid_revision_hash");
    const out = await approvePage(c, rec, b.revisionHash as string | undefined);
    if (!out.ok) return c.json(out.body, out.status);
    const fresh = await lpStub(c.env, s.tenantId).get(id);
    return c.json({
      ok: true,
      status: out.status,
      approvals: out.approvals,
      required: out.required,
      ...(fresh && fresh.owner === s.principal.id ? { draft: await toDraft(c.env, fresh) } : {}),
    });
  });

  // ---- publish, unpublish ----

  r.post("/lp/:id/publish", async (c) => {
    const rec = await owned(c);
    const s = sess(c);
    const blocked = notMcp(c);
    if (blocked) return blocked;
    const raw = (await c.req.text()).trim();
    const b = raw ? await parseObject(raw) : {};
    const store = lpStub(c.env, s.tenantId);
    // No public URL before an independent approval of exactly this revision.
    const ready = await store.publishable(rec.id);
    if (!ready.ok)
      return c.json({ error: "not_approved", reason: "The page has not been approved" }, 403);
    const base = baseUrl(c.env);
    if (!base) return c.json({ error: "pages_host_unconfigured" }, 503);
    let utm: Utm | null = null;
    if (b.utm !== undefined && b.utm !== null) {
      const u = b.utm as Record<string, unknown>;
      if (typeof u !== "object" || Array.isArray(u)) throw bad("invalid_utm");
      utm = {};
      for (const k of ["source", "medium", "campaign"] as const) {
        const v = u[k];
        if (v === undefined || v === "") continue;
        if (typeof v !== "string" || !UTM_VALUE.test(v)) throw bad("invalid_utm");
        utm[k] = v;
      }
    }
    let days = DEFAULT_DAYS;
    if (b.days !== undefined) {
      if (
        typeof b.days !== "number" ||
        !Number.isInteger(b.days) ||
        b.days < 1 ||
        b.days > MAX_DAYS
      )
        throw bad("invalid_days");
      days = b.days;
    }
    // The checks are the last word: a permission withdrawn after approval stops the page here.
    const res = await runChecks(new Brain(c, rec.lang), rec);
    if (!res.ok) return c.json({ error: "checks_failed", ...res }, 422);
    if (
      !(await audit(c, {
        action: "lp.publish",
        nodeId: rec.id,
        scopeId: null,
        revision: rec.revision,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const slug = hexId(16); // 128 bits: unguessable
    const expiresAt = now(c) + days * DAY_MS;
    // Images are copied into the pages bucket now, from the approved record: the published page never
    // points at the brain or at anything outside its own bucket.
    const images: string[] = [];
    for (const [n, ref] of rec.references.entries()) {
      const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(ref.image ?? "");
      if (!m) {
        images.push("");
        continue;
      }
      const bytes = Uint8Array.from(atob(m[2] as string), (ch) => ch.charCodeAt(0));
      await c.env.PAGES.put(imageKey(slug, n), bytes, {
        httpMetadata: { contentType: m[1] as string },
        customMetadata: { expiresAt: String(expiresAt) },
      });
      images.push(`/p/${slug}/i/${n}`);
    }
    await c.env.PAGES.put(pageKey(slug), renderLandingPage(renderData(rec, "published", images)), {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: { expiresAt: String(expiresAt) },
    });
    const made = await store.markPublished(rec.id, slug, expiresAt, utm, now(c));
    if (!made.ok) {
      await deletePage(c.env, slug);
      throw new HTTPException(409, { message: "publish_failed" });
    }
    return c.json({ url: urlOf(c.env, made.record), expiresAt: new Date(expiresAt).toISOString() });
  });

  r.post("/lp/:id/unpublish", async (c) => {
    const rec = await owned(c);
    const s = sess(c);
    const blocked = notMcp(c);
    if (blocked) return blocked;
    if (rec.status !== "published" || !rec.slug)
      return c.json({ error: "not_published", reason: "The page is not published" }, 409);
    if (
      !(await audit(c, {
        action: "lp.unpublish",
        nodeId: rec.id,
        scopeId: null,
        revision: rec.revision,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const stats = await readStats(c.env, rec.slug);
    // The object goes first: the next request to the public URL is already a 404.
    await deletePage(c.env, rec.slug);
    await lpStub(c.env, s.tenantId).markUnpublished(rec.id, stats, now(c));
    return c.json({ ok: true });
  });

  r.get("/lp/:id/stats", async (c) => c.json(await statsOf(c.env, await owned(c))));

  return r;
}
