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
