import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, setPersona as storePersona } from "./api";
import { I18nProvider, initialLang, isLang, type Lang, storeLang } from "./i18n";
import { applyTheme, readTheme, storeTheme, type Theme } from "./lib/theme";
import type { Me } from "./types";

interface AppState {
  me: Me | null;
  meError: string | null;
  /** Bumps when the demo persona changes, so every view refetches as the new viewer. */
  epoch: number;
  setPersona: (id: string) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  toast: string | null;
  say: (msg: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [toast, setToast] = useState<string | null>(null);
  const [lang, setLangState] = useState<Lang>(initialLang);
  // True once the person has picked a language by hand, so a late preference never overrides it.
  const chosen = useRef(false);

  useEffect(() => {
    let live = true;
    api.me().then(
      (m) => {
        if (!live) return;
        setMe(m);
        setMeError(null);
        // Preferences follow the person across devices. Failing to read them changes nothing.
        api.prefs().then(
          (p) => {
            if (!live) return;
            if (isLang(p.lang) && !chosen.current) {
              setLangState(p.lang);
              storeLang(p.lang);
            }
          },
          () => {},
        );
      },
      (e: unknown) =>
        live && setMeError(e instanceof Error ? e.message : "Could not load your profile."),
    );
    return () => {
      live = false;
    };
  }, [epoch]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    storeTheme(t);
    setThemeState(t);
  }, []);

  const setPersona = useCallback((id: string) => {
    storePersona(id);
    setEpoch((e) => e + 1);
  }, []);

  const setLang = useCallback((l: Lang) => {
    chosen.current = true;
    setLangState(l);
    storeLang(l);
    api.savePrefs({ lang: l }).catch(() => {});
  }, []);

  const value = useMemo<AppState>(
    () => ({
      me,
      meError,
      epoch,
      setPersona,
      theme,
      setTheme,
      toast,
      say: setToast,
    }),
    [me, meError, epoch, setPersona, theme, setTheme, toast],
  );
  return (
    <Ctx.Provider value={value}>
      <I18nProvider lang={lang} setLang={setLang}>
        {children}
      </I18nProvider>
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
