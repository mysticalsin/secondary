// AI processor configuration. Everything here is read from the environment per request, so the kill
// switch and the key take effect without a deploy. Nothing in this file holds a secret value.

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_DAILY_TOKEN_BUDGET = 200_000;
/** One person's share of the tenant's day (M-06): a fifth of the default tenant budget. */
export const DEFAULT_USER_DAILY_TOKEN_BUDGET = 40_000;
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Per-request limits (BUILD-PLAN-B2 section 4). */
export const LIMITS = {
  maxExcerpts: 8,
  maxEvidenceTokens: 12_000,
  maxOutputTokens: 1_500,
  maxPlannerOutputTokens: 800,
  retries: 2,
} as const;

/** The AI-specific names that are not in wrangler.jsonc. `AI_MODEL` is a var, the key is a secret. */
export interface AiEnv {
  ANTHROPIC_API_KEY?: string;
  /** Explicit enable. AI is off unless this is "true" (or yes, 1, on). */
  AI_ENABLED?: string;
  /** Must be exactly "approved": the processor contract (DPA) for the Anthropic API is signed off. */
  AI_PROCESSOR_CONTRACT?: string;
  AI_MODEL?: string;
  /** Tokens per tenant per UTC day. */
  AI_DAILY_TOKEN_BUDGET?: string;
  /** Tokens per person per UTC day (default 40000), so one user cannot spend the tenant's whole day. */
  AI_USER_DAILY_TOKEN_BUDGET?: string;
  AI_TIMEOUT_MS?: string;
}

export type AiState =
  | { state: "disabled" }
  | { state: "not_configured" }
  | { state: "contract_missing" }
  | {
      state: "ready";
      apiKey: string;
      model: string;
      dailyBudget: number;
      userDailyBudget: number;
      timeoutMs: number;
    };

const ON = new Set(["1", "true", "on", "yes"]);

const posInt = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return v !== undefined && Number.isSafeInteger(n) && n > 0 ? n : fallback;
};

export function aiState(env: AiEnv): AiState {
  // Fail closed (M-06): a key alone never switches AI on. It needs an explicit enable and an approved
  // processor contract before any text leaves the system.
  if (!ON.has((env.AI_ENABLED ?? "").trim().toLowerCase())) return { state: "disabled" };
  if ((env.AI_PROCESSOR_CONTRACT ?? "").trim().toLowerCase() !== "approved")
    return { state: "contract_missing" };
  const apiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) return { state: "not_configured" };
  const model = (env.AI_MODEL ?? "").trim();
  return {
    state: "ready",
    apiKey,
    model: /^[a-z0-9][a-z0-9._-]{2,80}$/.test(model) ? model : DEFAULT_MODEL,
    dailyBudget: posInt(env.AI_DAILY_TOKEN_BUDGET, DEFAULT_DAILY_TOKEN_BUDGET),
    userDailyBudget: posInt(env.AI_USER_DAILY_TOKEN_BUDGET, DEFAULT_USER_DAILY_TOKEN_BUDGET),
    timeoutMs: posInt(env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

/** Rough token estimate (4 characters per token), used for budgets and the evidence ceiling. */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);

/** My Agent (v6): the bounded tool loop and the per-person turn rate. */
export const AGENT_LIMITS = {
  /** Model rounds per turn: tool rounds plus the answer. */
  maxRounds: 4,
  /** Tool calls the model may make in one round, and in one turn. */
  maxCallsPerRound: 6,
  maxCallsPerTurn: 12,
  /** One round's output cap (thinking plus a program of at most 8 KB). */
  maxOutputTokens: 3_000,
  turnsPerMin: 20,
} as const;
