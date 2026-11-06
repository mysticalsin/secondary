// My Agent preferences and history live on this device only (localStorage), never on the server.
// Every read and write is wrapped, so a blocked or full store changes nothing but persistence.
import { getPersona } from "../api";

export type Density = "compact" | "comfortable";
export type CardTheme = "dark" | "light";
export type AnswerLang = "follow" | "en" | "fr";

export interface AgentSettings {
  density: Density;
  theme: CardTheme;
  lang: AnswerLang;
  tokens: boolean;
}

export const DEFAULTS: AgentSettings = {
  density: "comfortable",
  theme: "dark",
  lang: "follow",
  tokens: false,
};

const KEY = "secondary.agent.settings";
export const SETTINGS_EVENT = "secondary:agent-settings";

const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : d;

/** Anything stored is re-checked field by field; unknown or broken values fall back to defaults. */
export function normalizeSettings(raw: unknown): AgentSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    density: oneOf(o.density, ["compact", "comfortable"], DEFAULTS.density),
    theme: oneOf(o.theme, ["dark", "light"], DEFAULTS.theme),
    lang: oneOf(o.lang, ["follow", "en", "fr"], DEFAULTS.lang),
    tokens: o.tokens === true,
  };
}

export function readSettings(): AgentSettings {
  try {
    const s = window.localStorage.getItem(KEY);
    return normalizeSettings(s ? JSON.parse(s) : null);
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(patch: Partial<AgentSettings>): AgentSettings {
  const next = normalizeSettings({ ...readSettings(), ...patch });
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* not remembered */
  }
  try {
    window.dispatchEvent(new Event(SETTINGS_EVENT));
  } catch {
    /* no window */
  }
  return next;
}

// ---- history: programs only, never data ----

export interface HistoryEntry {
  id: string;
  /** What the person asked, as shown in the thread. */
  label: string;
  /** The answer's program text (plan only). */
  program: string;
  at: number;
  mode?: "ai" | "deterministic";
  reason?: string;
  tokens?: number | null;
  dropped?: number;
}

const HKEY = "secondary.agent.history";
const MAX_ENTRIES = 20;
const MAX_PROGRAM = 8192;
const hkey = (): string => `${HKEY}.${getPersona() ?? "none"}`;

const isEntry = (e: unknown): e is HistoryEntry => {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.label === "string" &&
    typeof o.program === "string" &&
    typeof o.at === "number"
  );
};

export function readHistory(): HistoryEntry[] {
  try {
    const s = window.localStorage.getItem(hkey());
    const v: unknown = s ? JSON.parse(s) : [];
    return Array.isArray(v) ? v.filter(isEntry).slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function writeHistory(list: readonly HistoryEntry[]): void {
  try {
    const keep = list
      .filter((e) => e.program.length <= MAX_PROGRAM)
      .slice(-MAX_ENTRIES)
      .map((e) => ({ ...e, label: e.label.slice(0, 500) }));
    window.localStorage.setItem(hkey(), JSON.stringify(keep));
  } catch {
    /* not remembered */
  }
}

export function clearHistory(): void {
  try {
    window.localStorage.removeItem(hkey());
  } catch {
    /* nothing to clear */
  }
  try {
    window.dispatchEvent(new Event(SETTINGS_EVENT));
  } catch {
    /* no window */
  }
}
