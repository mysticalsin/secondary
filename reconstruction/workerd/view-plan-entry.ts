/**
 * NEW RECONSTRUCTION entry so Wrangler can bundle the recovered view-plan gate.
 * The recovered validator file is not edited. This file is not a product route.
 */
import { sanitizeViewPlan } from "../mcp/worker/src/view/plan.ts";

export default {
  async fetch(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, errors: ["invalid_json"] }, { status: 400 });
    }
    return Response.json(sanitizeViewPlan(body));
  },
};
