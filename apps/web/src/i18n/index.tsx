// A small dictionary module. Every UI string lives in en.ts and fr.ts. `t` is typed on the key,
// so a missing key is a compile error, and fr.ts must define every key that en.ts defines.

import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { en } from "./en";
import { fr } from "./fr";

export type Lang = "en" | "fr";
export type Key = keyof typeof en;
export type Vars = Record<string, string | number>;

export const LANGS: readonly Lang[] = ["en", "fr"];
const DICTS: Record<Lang, Record<Key, string>> = { en, fr };
const STORE = "secondary.lang";

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "fr";
}

/** The stored choice, else the browser language, else English. */
export function initialLang(): Lang {
  try {
    const s = window.localStorage.getItem(STORE);
    if (isLang(s)) return s;
  } catch {
    /* storage unavailable: fall through to the browser language */
  }
  const nav = typeof navigator === "undefined" ? "en" : (navigator.language ?? "en");
  return nav.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function storeLang(l: Lang): void {
  try {
    window.localStorage.setItem(STORE, l);
  } catch {
    /* storage unavailable: the choice lasts for this page load */
  }
}

let current: Lang = "en";
/** The language in effect, for code that runs outside React (error wording in api.ts). */
export const getLang = (): Lang => current;

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const raw = DICTS[lang][key] ?? en[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Pick the singular or plural key by count. */
export function plural(lang: Lang, n: number, one: Key, other: Key, vars?: Vars): string {
  return translate(lang, n === 1 ? one : other, { n, ...vars });
}

export interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Vars) => string;
  /** Like t, for a key that comes from data (a server status or section key). Falls back to `fallback`. */
  td: (prefix: string, value: string, fallback?: string) => string;
  tn: (n: number, one: Key, other: Key, vars?: Vars) => string;
  /** Intl locale tag for dates and numbers. */
  locale: string;
}

const noop = () => {};
const fallback: I18n = {
  lang: "en",
  setLang: noop,
  t: (k, v) => translate("en", k, v),
  td: (p, v, f) => (`${p}.${v}` in en ? en[`${p}.${v}` as Key] : (f ?? v)),
  tn: (n, o, m, v) => plural("en", n, o, m, v),
  locale: "en-CA",
};

const Ctx = createContext<I18n>(fallback);

export function I18nProvider({
  lang,
  setLang,
  children,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  children: ReactNode;
}) {
  current = lang;
  const t = useCallback((key: Key, vars?: Vars) => translate(lang, key, vars), [lang]);
  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t,
      td: (p, v, f) => {
        const k = `${p}.${v}` as Key;
        return k in en ? translate(lang, k) : (f ?? v);
      },
      tn: (n, o, m, v) => plural(lang, n, o, m, v),
      locale: lang === "fr" ? "fr-CA" : "en-CA",
    }),
    [lang, setLang, t],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = (): I18n => useContext(Ctx);
export const useT = (): I18n["t"] => useContext(Ctx).t;
