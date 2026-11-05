// The automatic checks of a landing page (docs/DESIGN-LP-STUDIO.md section 1, step 3). They run on the
// server, as the page's owner, against the live brain, whatever the client says. Three kinds:
//   - customer-permission: no client name appears unless a CustomerPermission for the channel "landing
//     page" covers that exact reference; every reference is resolved again, so a permission that was
//     withdrawn since the draft was made is caught here
//   - sensitivity: the R-110 personal-segment detector and the R-111 contact and personal-wording scan
//   - length: every slot is filled and within its limit
// The prospect's own role and company are the page's subject, so they are not scanned as sensitive text.

import { excludePersonalSegments } from "../ai/segments.ts";
import { detectSensitivity } from "../sensitivity.ts";
import { residualIdentifiers } from "../wiki/text.ts";
import { type Brain, sameCompany } from "./refs.ts";
import {
  type CheckResult,
  type Issue,
  type PageRecord,
  SLOT_MAX,
  SLOTS,
  type Slot,
} from "./types.ts";

const REQUIRED: readonly Slot[] = ["hero", "intro", "cta"];

/** The text the sensitivity scan reads: the page's own subject (role, company, first name) is not scanned. */
function scannable(text: string, rec: Pick<PageRecord, "prospect">): string {
  let t = text;
  for (const own of [rec.prospect.role, rec.prospect.company, rec.prospect.firstName ?? ""]) {
    const s = own.trim();
    if (s.length >= 2) t = t.split(s).join(" ");
  }
  return t;
}

const nameIn = (text: string, ids: string[]): boolean =>
  residualIdentifiers(text, ids).includes("account name or id");

export async function runChecks(brain: Brain, rec: PageRecord): Promise<CheckResult> {
  const issues: Issue[] = [];

  // ---- length ----
  for (const s of SLOTS) {
    const v = rec.slots[s];
    if (!v.trim() && REQUIRED.includes(s))
      issues.push({ slot: s, kind: "length", detail: "This section is empty", fix: "Write it" });
    else if (v.length > SLOT_MAX[s])
      issues.push({
        slot: s,
        kind: "length",
        detail: `${v.length} characters, the limit is ${SLOT_MAX[s]}`,
        fix: "Shorten it",
      });
  }

  // ---- references, resolved again as the owner sees the brain now ----
  const now = await brain.resolve(rec.references.map((r) => r.pageId));
  const namedAccounts = new Set<string>();
  rec.references.forEach((ref, i) => {
    const slot = `references[${i}]`;
    const live = now[i];
    if (!live) {
      issues.push({
        slot,
        kind: "customer-permission",
        detail:
          "This reference is no longer available to you, or cannot be shown without naming a client",
        fix: "Remove it",
      });
      return;
    }
    if (ref.permission === "named") {
      if (live.permission !== "named") {
        issues.push({
          slot,
          kind: "customer-permission",
          detail: "No customer permission for the channel landing page covers this client any more",
          fix: "Use the generalised version",
        });
        return;
      }
      // The words a customer agreed to, exactly. Anything else on the page about them is not covered.
      if (ref.title !== live.title || ref.summary !== live.summary)
        issues.push({
          slot,
          kind: "customer-permission",
          detail: "The text differs from the words the customer permission covers",
          fix: "Restore the permitted text",
        });
      namedAccounts.add(ref.pageId.split("/")[0] ?? "");
    } else if (live.permission === "generalised-only" && live.summary !== ref.summary) {
      issues.push({
        slot,
        kind: "customer-permission",
        detail: "The generalised text changed in the brain",
        fix: "Reload the reference",
      });
    }
  });

  // ---- no client name anywhere, unless that client is named by a permitted reference ----
  const guard = brain.accounts.filter(
    (a) => !namedAccounts.has(a.id) && !sameCompany(a.label, rec.prospect.company),
  );
  const texts: [string, string][] = [
    ...SLOTS.map((s): [string, string] => [s, rec.slots[s]]),
    ...rec.references.map((r, i): [string, string] => [
      `references[${i}]`,
      `${r.title}\n${r.summary}`,
    ]),
  ];
  for (const [slot, text] of texts) {
    for (const a of guard) {
      if (nameIn(text, a.ids)) {
        issues.push({
          slot,
          kind: "customer-permission",
          detail: `Names a client (${a.label}) without a customer permission for the channel landing page`,
          fix: "Say it without the name",
        });
        break;
      }
    }
  }

  // ---- sensitivity ----
  const scan: [string, string][] = [
    ...SLOTS.map((s): [string, string] => [s, rec.slots[s]]),
    ...rec.references.map((r, i): [string, string] => [
      `references[${i}]`,
      `${r.title}\n${r.summary}`,
    ]),
  ];
  for (const [slot, text] of scan) {
    const t = scannable(text, rec);
    const flags = detectSensitivity({ body: t });
    const seen = new Set<string>();
    for (const f of flags) {
      seen.add(f.type);
      issues.push({
        slot,
        kind: "sensitivity",
        detail: `Contains ${f.type === "email" ? "an email address" : f.type === "phone" ? "a phone number" : `${f.type} wording`} ("${f.excerpt}")`,
        fix: "Remove it",
      });
    }
    // R-110: whatever the pre-share scan did not name but the personal-segment detector does.
    for (const e of excludePersonalSegments(t).excluded)
      if (!seen.has(e.category))
        issues.push({
          slot,
          kind: "sensitivity",
          detail: `Personal content (${e.category}): "${e.excerpt}"`,
          fix: "Remove it",
        });
  }

  return { ok: issues.length === 0, issues };
}
