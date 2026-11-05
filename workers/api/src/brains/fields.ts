// Business fields: a typed schema per brain, and what a field's sensitivity does (API-CONTRACT "v3
// brains", Business fields). `fieldsFor` is the one place that decides what a caller may see of a
// value: masking, the AI gate and the export filter all go through it.

import { roleAllows } from "@secondary/policy";
import { humanIdsOf } from "../human.ts";
import { detectSensitivity } from "../sensitivity.ts";
import { type C, sess } from "../ux/util.ts";
import {
  type FieldDef,
  fieldAppliesTo,
  normaliseValue,
  type Sensitivity,
} from "./model.ts";
import type { Brain } from "./open.ts";

export type Purpose = "view" | "export" | "ai";

export interface FieldOut {
  key: string;
  label: string;
  type: string;
  sensitivity: Sensitivity;
  value: string | null;
  masked: boolean;
}

type Stub = Brain["stub"];

/**
 * The fields of one page as this caller may see them, for a purpose.
 * - none: every reader (and export and AI).
 * - confidential: a caller who can edit, never an agent session, never export.
 * - personal: only the person who wrote the value, never an agent session, never export.
 */
export async function fieldsFor(
  c: C,
  b: { stub: Stub; personal: boolean; can: { edit: boolean } },
  page: { id: string; type: string },
  purpose: Purpose = "view",
): Promise<FieldOut[]> {
  const config = await b.stub.brainConfig();
  const defs = config.fields.filter((f) => fieldAppliesTo(f, page.type));
  if (!defs.length) return [];
  const s = sess(c);
  const values = new Map((await b.stub.brainFieldValues(page.id)).map((v) => [v.key, v]));
  const agent = s.internal !== null || purpose === "ai";
  const mine = purpose === "view" && !agent ? new Set(await humanIdsOf(c.env, s)) : new Set<string>();
  // A stored brain role only narrows: looked up when a confidential field makes it matter.
  const needsRole = purpose === "view" && !agent && !b.personal && defs.some((f) => f.sensitivity === "confidential");
  const role = needsRole ? await b.stub.brainRoleOf(await humanIdsOf(c.env, s)) : null;
  const canEdit = b.can.edit && roleAllows(role, "edit");
  const out: FieldOut[] = [];
  for (const f of defs) {
    const v = values.get(f.key);
    let show = true;
    if (f.sensitivity === "confidential") show = purpose === "view" && !agent && canEdit;
    else if (f.sensitivity === "personal") show = !!v && mine.has(v.writtenBy);
    if (purpose !== "view" && f.sensitivity !== "none") {
      // Export and the AI gate leave sensitive fields out altogether, not masked.
      continue;
    }
    out.push({
      key: f.key,
      label: f.label,
      type: f.type,
      sensitivity: f.sensitivity,
      value: v && show ? v.value : null,
      masked: !!v && !show,
    });
  }
  return out;
}

export type WriteResult =
  | { ok: true; writes: { key: string; value: string | null }[] }
  | { ok: false; status: 400 | 422; body: Record<string, unknown> };

/** Check a write against the schema and the sensitivity rules. Nothing is stored here. */
export function checkWrite(
  b: { personal: boolean },
  defs: FieldDef[],
  pageType: string,
  values: unknown,
  acknowledged: string[],
): WriteResult {
  if (!values || typeof values !== "object" || Array.isArray(values))
    return { ok: false, status: 400, body: { error: "invalid_values" } };
  const writes: { key: string; value: string | null }[] = [];
  const flagsOut: { id: string; key: string; type: string }[] = [];
  for (const [key, raw] of Object.entries(values as Record<string, unknown>)) {
    const f = defs.find((d) => d.key === key && fieldAppliesTo(d, pageType));
    if (!f) return { ok: false, status: 422, body: { error: "unknown_field", key } };
    if (raw === null) {
      writes.push({ key, value: null });
      continue;
    }
    if (typeof raw !== "string") return { ok: false, status: 422, body: { error: "invalid_value", key } };
    const v = normaliseValue(f, raw);
    if (v === null || v === "") return { ok: false, status: 422, body: { error: "invalid_value", key } };
    // Personal data about people is never stored in a shared brain.
    if (f.sensitivity === "personal" && !b.personal)
      return {
        ok: false,
        status: 422,
        body: {
          error: "personal_field_shared_brain",
          key,
          reason: "A personal field can only hold a value in a Personal Brain",
        },
      };
    for (const flag of detectSensitivity({ body: v }))
      if (f.sensitivity === "none" || !acknowledged.includes(flag.id))
        flagsOut.push({ id: flag.id, key, type: flag.type });
    writes.push({ key, value: v });
  }
  if (flagsOut.length)
    return {
      ok: false,
      status: 422,
      body: {
        error: "sensitive_value",
        reason:
          "A value looks like contact details or personal matters. Remove it, or mark the field confidential and acknowledge the flags",
        flags: flagsOut,
      },
    };
  return { ok: true, writes };
}

/** What an export may carry of a page's fields: the `none` ones only, as a plain key to value map. */
export function exportProperties(
  defs: FieldDef[],
  values: { pageId: string; key: string; value: string }[],
  page: { id: string; type: string },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of defs)
    if (f.sensitivity === "none" && fieldAppliesTo(f, page.type)) {
      const v = values.find((x) => x.pageId === page.id && x.key === f.key);
      if (v) out[f.key] = v.value;
    }
  return out;
}
