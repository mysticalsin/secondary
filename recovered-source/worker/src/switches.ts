// Kill switches. Absence of a row means "on". Names are fixed here so no caller can invent one.

export const SWITCHES = ["mcp", "connector", "ai", "contribute"] as const;
export type SwitchName = (typeof SWITCHES)[number];
export type SwitchState = Record<SwitchName, boolean>;

export const isSwitchName = (v: unknown): v is SwitchName =>
  typeof v === "string" && (SWITCHES as readonly string[]).includes(v);

export const allOn = (): SwitchState => ({
  mcp: true,
  connector: true,
  ai: true,
  contribute: true,
});

export const switchedOff = (name: SwitchName) => ({ error: "switched_off" as const, switch: name });

export type HandlerKey =
  | "submitCandidate"
  | "routineRun"
  | "routineIngest"
  | "briefSave"
  | "aiCall"
  | "sourceSearch"
  | "wikiSource"
  | "sharepoint";

type Row = {
  name: SwitchName;
  /** Set for the switch that blocks every internal call, before any path row. */
  internal?: boolean;
  http?: (method: string, path: string) => boolean;
  handlers?: readonly HandlerKey[];
};

// One declaration. The middleware reads `http`. Handlers read `handlers`.
// Wiki ingest has no session: it reads the tenant `ai` switch itself (wiki/engine.ts).
export const SWITCH_TABLE: readonly Row[] = [
  { name: "mcp", internal: true },
  {
    name: "contribute",
    http: (m, p) => m === "POST" && /^\/v1\/personal\/items\/[^/]+\/contribute$/.test(p),
    handlers: ["submitCandidate", "routineRun", "routineIngest"],
  },
  {
    // Planner, /v1/ai/*, and briefs (H-05). `gate()` still checks the processor contract.
    name: "ai",
    http: (_m, p) =>
      p === "/v1/genui/plan" ||
      p.startsWith("/v1/ai/") ||
      p === "/v1/briefs" ||
      p.startsWith("/v1/briefs/"),
    handlers: ["briefSave", "aiCall"],
  },
  {
    // /v1/sources and /v1/connectors (M-04). Search and wiki citations omit hits instead of 503.
    name: "connector",
    http: (_m, p) => p.startsWith("/v1/connectors/") || p.startsWith("/v1/sources/"),
    handlers: ["sourceSearch", "wikiSource", "sharepoint"],
  },
];

export function httpSwitch(method: string, path: string): SwitchName | null {
  for (const row of SWITCH_TABLE) if (row.http?.(method, path)) return row.name;
  return null;
}

export function handlerSwitch(key: HandlerKey): SwitchName {
  const row = SWITCH_TABLE.find((r) => r.handlers?.includes(key));
  if (!row) throw new Error("switch handler is not in the table");
  return row.name;
}

export function internalSwitch(): SwitchName {
  const row = SWITCH_TABLE.find((r) => r.internal);
  if (!row) throw new Error("internal switch is not in the table");
  return row.name;
}

export function sessionSwitchOn(session: { switches: SwitchState }, key: HandlerKey): boolean {
  return session.switches[handlerSwitch(key)];
}

export function sessionSwitchOff(session: { switches: SwitchState }, key: HandlerKey): boolean {
  return !sessionSwitchOn(session, key);
}
