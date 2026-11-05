// Light is the default. Dark and "follow the system" are choices in Settings > Appearance.
export type Theme = "light" | "dark" | "system";
const KEY = "secondary.theme";
const SIDE = "secondary.sidebar";

export const isTheme = (v: unknown): v is Theme => v === "light" || v === "dark" || v === "system";

export function readTheme(): Theme {
  try {
    const v = window.localStorage.getItem(KEY);
    if (isTheme(v)) return v;
  } catch {
    /* storage unavailable: light */
  }
  return "light";
}

export function storeTheme(t: Theme): void {
  try {
    window.localStorage.setItem(KEY, t);
  } catch {
    /* the choice lasts for this page load */
  }
}

export function resolveTheme(t: Theme): "light" | "dark" {
  if (t !== "system") return t;
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(t);
}

export const readCollapsed = (): boolean => {
  try {
    return window.localStorage.getItem(SIDE) === "1";
  } catch {
    return false;
  }
};

export const storeCollapsed = (v: boolean): void => {
  try {
    window.localStorage.setItem(SIDE, v ? "1" : "0");
  } catch {
    /* not remembered */
  }
};
