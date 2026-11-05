// Types only (erased at build): the contracts package entry pulls in ajv, which the worker must not bundle.
import type { ViewPlan } from "../../../../packages/contracts/src/view-plan.ts";
import { COMPONENT_TYPES, validate } from "../generated/view-plan-validator.js";

const CATALOG = new Set<string>(COMPONENT_TYPES);

export interface DroppedComponent {
  index: number;
  type: string;
}

export type SanitizeResult =
  | { ok: true; plan: ViewPlan; dropped: DroppedComponent[] }
  | { ok: false; errors: string[]; dropped: DroppedComponent[] };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Trust boundary for render_view. Order matters:
 *  1. components whose `type` is not in the catalog are dropped (and reported),
 *  2. what is left must pass the precompiled ViewPlan schema. Props are queries only
 *     (additionalProperties:false everywhere), so inline data such as `rows`, `items` or `html`
 *     fails here and the whole plan is rejected. Nothing is repaired or coerced.
 */
export function sanitizeViewPlan(input: unknown): SanitizeResult {
  if (!isObject(input) || !Array.isArray(input.components)) {
    return {
      ok: false,
      errors: ["viewPlan must be an object with a components array"],
      dropped: [],
    };
  }
  const dropped: DroppedComponent[] = [];
  const kept: unknown[] = [];
  input.components.forEach((c, index) => {
    if (isObject(c) && typeof c.type === "string" && CATALOG.has(c.type)) kept.push(c);
    else
      dropped.push({ index, type: isObject(c) && typeof c.type === "string" ? c.type : "invalid" });
  });
  const candidate = { ...input, components: kept };
  if (kept.length === 0) {
    return { ok: false, errors: ["no component from the catalog remains"], dropped };
  }
  if (!validate(candidate)) {
    const errors = (validate.errors ?? [])
      .slice(0, 12)
      .map((e) => `${e.instancePath || "/"} ${e.keyword}: ${e.message ?? ""}`.trim());
    return { ok: false, errors: errors.length ? errors : ["schema validation failed"], dropped };
  }
  return { ok: true, plan: candidate as unknown as ViewPlan, dropped };
}
