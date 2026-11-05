// Landing pages in the Questions inbox (kind release). A page sent to review becomes one question for each
// person who may decide it: the policy says so (approve_release on Company Global) and they did not write
// the page. The question carries the rendered preview that was stored at submission, a diff against the
// previous revision and the revision hash to name when approving. Resolving it runs the same service as
// POST /v1/lp/:id/approve.

import { viewOf } from "../auth.ts";
import { humanIdsOf } from "../human.ts";
import { type C, sess } from "../ux/util.ts";
import type { Question } from "../uxv2/questions.ts";
import { iso } from "../uxv2/shared.ts";
import { toDraft } from "./draft.ts";
import { approvePage, mayDecide, RELEASE_NODE, requestPageChanges } from "./review.ts";
import { lpStub } from "./stub.ts";
import { type PageRecord, revisionHashOf, SLOTS } from "./types.ts";

export const LP_QID = /^lp:[0-9a-f]{16}$/;
const MAX = 50;

const short = (s: string, n = 240): string => s.replace(/\s+/g, " ").trim().slice(0, n);
export const questionIdOf = (pageId: string): string => `lp:${pageId.slice(3)}`;
export const pageIdOf = (qid: string): string => `lp_${qid.slice(3)}`;

/** The slots that changed against the revision before, and the references that came or went. */
async function diffOf(c: C, rec: PageRecord) {
  const prev =
    rec.revision > 1
      ? await lpStub(c.env, sess(c).tenantId).snapshotOf(rec.id, rec.revision - 1)
      : null;
  const out: { slot: string; before: string; after: string }[] = [];
  for (const s of SLOTS) {
    const before = prev?.slots[s] ?? "";
    if (before !== rec.slots[s]) out.push({ slot: s, before, after: rec.slots[s] });
  }
  const was = new Set(prev?.references ?? []);
  const now = new Set(rec.references.map((x) => x.title));
  for (const t of now) if (!was.has(t)) out.push({ slot: "references", before: "", after: t });
  for (const t of was) if (!now.has(t)) out.push({ slot: "references", before: t, after: "" });
  return out;
}

/** The revision before this one, as the reviewer's diff reads it. Null for a first revision. */
async function previousOf(c: C, rec: PageRecord) {
  const prev =
    rec.revision > 1
      ? await lpStub(c.env, sess(c).tenantId).snapshotOf(rec.id, rec.revision - 1)
      : null;
  if (!prev) return null;
  return {
    revision: rec.revision - 1,
    slots: prev.slots,
    contact: prev.contact ?? rec.contact,
    // Snapshots from before references were kept in full carry titles only.
    references:
      prev.refs ??
      prev.references.map((title) => ({
        pageId: "",
        title,
        summary: "",
        permission: "generalised-only" as const,
      })),
  };
}

/** Pages waiting for this caller's decision. Empty for anyone the policy does not let decide. */
export async function lpQuestions(c: C): Promise<Question[]> {
  const s = sess(c);
  if (s.internal || s.org === null) return [];
  // A caller whose view cannot even reach Company Global releases nothing.
  if (!viewOf(s).nodes.has(RELEASE_NODE)) return [];
  const store = lpStub(c.env, s.tenantId);
  const rows = await store.inReview(MAX);
  if (!rows.length) return [];
  const humans = new Set([...(await humanIdsOf(c.env, s)), s.principal.id]);
  const email = s.principal.email.trim().toLowerCase();
  const out: Question[] = [];
  for (const rec of rows) {
    if (!mayDecide(c, rec).allowed) continue;
    if (humans.has(rec.owner) || rec.ownerEmail.trim().toLowerCase() === email) continue;
    const ed = await store.editors(rec.id);
    if (ed.ids.some((x) => humans.has(x)) || ed.emails.includes(email)) continue;
    out.push({
      id: questionIdOf(rec.id),
      kind: "release",
      title: `Landing page: ${rec.prospect.role} at ${rec.prospect.company}`,
      workspaceId: RELEASE_NODE,
      createdAt: iso(rec.updatedAt),
      summary: short(rec.slots.hero),
      options: [
        { action: "approve", label: "Approve page" },
        { action: "request_changes", label: "Ask for changes" },
      ],
      detail: {
        revisionHash: await revisionHashOf(rec),
        approvals: 0,
        required: 1,
        release: "landing_page",
        text: SLOTS.map((k) => rec.slots[k])
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 2_000),
        flags: [],
        // The page as it will be shown, to be displayed in a sandboxed frame. It is the stored rendering.
        previewHtml: rec.previewHtml ?? "",
        diff: await diffOf(c, rec),
        references: rec.references.map((r) => ({ title: r.title, permission: r.permission })),
        prospect: { role: rec.prospect.role, company: rec.prospect.company },
        brand: rec.brand,
        lang: rec.lang,
        expiresAt: iso(rec.expiresAt),
        // What the web app reads: the page as data (it renders it with the shared template in a sandboxed
        // frame) and the revision before, for the diff.
        landing: {
          id: rec.id,
          draft: await toDraft(c.env, rec),
          previous: await previousOf(c, rec),
        },
      },
    });
  }
  return out;
}

/** The answer to a question about a landing page: the HTTP status and body, as the questions route returns them. */
export async function resolveLpQuestion(
  c: C,
  qid: string,
  action: string,
  revisionHash: string | undefined,
  note: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const s = sess(c);
  const rec = s.org ? await lpStub(c.env, s.tenantId).get(pageIdOf(qid)) : null;
  if (rec?.status !== "in_review") return { status: 404, body: { error: "not_found" } };
  if (action !== "approve" && action !== "request_changes")
    return { status: 403, body: { error: "forbidden", reason: "Action not available" } };
  const out =
    action === "approve"
      ? await approvePage(c, rec, revisionHash)
      : await requestPageChanges(c, rec, note);
  if (!out.ok) return { status: out.status, body: out.body };
  return {
    status: 200,
    body: { ok: true, released: false, approvals: out.approvals, required: out.required },
  };
}
