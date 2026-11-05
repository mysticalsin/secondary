// AI processor configuration. Everything here is read from the environment per request, so the kill
// switch and the key take effect without a deploy. Nothing in this file holds a secret value.

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_DAILY_TOKEN_BUDGET = 200_000;
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
  /** Kill switch. Anything other than an explicit off value leaves the feature on. */
  AI_ENABLED?: string;
  AI_MODEL?: string;
  /** Tokens per tenant per UTC day. */
  AI_DAILY_TOKEN_BUDGET?: string;
  AI_TIMEOUT_MS?: string;
}

export type AiState =
  | { state: "disabled" }
  | { state: "not_configured" }
  | {
      state: "ready";
      apiKey: string;
      model: string;
      dailyBudget: number;
      timeoutMs: number;
    };

const OFF = new Set(["0", "false", "off", "no", "disabled"]);

const posInt = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return v !== undefined && Number.isSafeInteger(n) && n > 0 ? n : fallback;
};

export function aiState(env: AiEnv): AiState {
  if (OFF.has((env.AI_ENABLED ?? "").trim().toLowerCase())) return { state: "disabled" };
  const apiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) return { state: "not_configured" };
  const model = (env.AI_MODEL ?? "").trim();
  return {
    state: "ready",
    apiKey,
    model: /^[a-z0-9][a-z0-9._-]{2,80}$/.test(model) ? model : DEFAULT_MODEL,
    dailyBudget: posInt(env.AI_DAILY_TOKEN_BUDGET, DEFAULT_DAILY_TOKEN_BUDGET),
    timeoutMs: posInt(env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

/** Rough token estimate (4 characters per token), used for budgets and the evidence ceiling. */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);
