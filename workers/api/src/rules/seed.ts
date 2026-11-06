// The five synthetic rules of the design (docs/DESIGN-V7-GOVERN-OPERATE.md section 1, "Seed rules").
// Dev only, with the wiki seed. The first design seed ("agent proposals in shared brains need review")
// is a hard floor, so it is shown read-only and stored nowhere.

import { type RuleDraft, validateRule } from "@secondary/policy";
import { rulesClient } from "./client.ts";

export const RULES_SEED_VERSION = 1;

const draft = (v: unknown): RuleDraft => {
  const r = validateRule(v);
  if (!r.ok) throw new Error(`seed rule refused: ${JSON.stringify(r.issues)}`);
  return r.rule;
};

export const SEED_RULES: { id: string; body: RuleDraft }[] = [
  {
    id: "r_seed_client_global",
    body: draft({
      name: "Client names stay out of Global",
      scope: { kind: "tenant" },
      when: [
        { field: "action", op: "is_any_of", values: ["promote_to_global"] },
        { field: "content_flag", op: "is_any_of", values: ["client_name"] },
      ],
      then: {
        effect: "block",
        message: "A client name was found. Remove it before this goes to Company Global.",
      },
      except: { incident: false },
      status: "enforced",
    }),
  },
  {
    id: "r_seed_export_50",
    body: draft({
      name: "Exports over 50 pages need approval",
      scope: { kind: "tenant" },
      when: [
        { field: "action", op: "is_any_of", values: ["export"] },
        { field: "size_pages", op: "greater_than", values: ["50"] },
      ],
      then: { effect: "review" },
      except: { incident: true },
      status: "enforced",
    }),
  },
  {
    id: "r_seed_ai_unknown",
    body: draft({
      name: "Unknown AI contract blocks agent writes",
      scope: { kind: "brain_types", types: ["account"] },
      when: [
        { field: "actor", op: "is_any_of", values: ["agent"] },
        {
          field: "action",
          op: "is_any_of",
          values: ["propose_page", "propose_change", "write_session_report", "import"],
        },
        { field: "ai_contract", op: "is_any_of", values: ["unknown"] },
      ],
      then: {
        effect: "block",
        message: "This account has no AI contract on file. Ask an admin to record it first.",
      },
      except: { incident: false },
      status: "enforced",
    }),
  },
  {
    id: "r_seed_weekend_bid",
    body: draft({
      name: "Weekend agent writes to Bid & Pre-sales",
      scope: { kind: "brains", ids: ["c_bid"] },
      when: [
        { field: "actor", op: "is_any_of", values: ["agent"] },
        {
          field: "action",
          op: "is_any_of",
          values: ["propose_page", "propose_change", "write_session_report"],
        },
        { field: "time", op: "is_any_of", values: ["weekend"] },
      ],
      then: { effect: "two_approvers" },
      except: { incident: false },
      status: "monitor",
    }),
  },
];

/** Seed the synthetic rules once per version. Dev only, off with the wiki seed. */
export async function ensureRulesSeed(env: Env, tenantId: string, now: number): Promise<number> {
  // Same switch as the wiki seed: dev only, WIKI_SEED=off turns it off.
  if (env.ENVIRONMENT !== "dev" || String(env.WIKI_SEED ?? "").toLowerCase() === "off") return 0;
  return rulesClient(env, tenantId).seed(SEED_RULES, now, RULES_SEED_VERSION);
}
