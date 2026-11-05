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
import type { Me } from "./types";

interface AppState {
  me: Me | null;
  meError: string | null;
  /** Bumps when the demo persona changes, so every view refetches as the new viewer. */
  epoch: number;
  setPersona: (id: string) => void;
  drawerId: string | null;
  openNode: (id: string) => void;
  closeDrawer: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  toast: string | null;
  say: (msg: string) => void;
  /** Onboarding tour: open until the person dismisses it, remembered per user through the API. */
  tourOpen: boolean;
  openTour: () => void;
  finishTour: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [tourOpen, setTourOpen] = useState(false);
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
            setTourOpen(!p.tourDone && m.seeded);
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

  const setPersona = useCallback((id: string) => {
    storePersona(id);
    setDrawerId(null);
    setEpoch((e) => e + 1);
  }, []);

  const setLang = useCallback((l: Lang) => {
    chosen.current = true;
    setLangState(l);
    storeLang(l);
    api.savePrefs({ lang: l }).catch(() => {});
  }, []);

  const finishTour = useCallback(() => {
    setTourOpen(false);
    api.savePrefs({ tourDone: true }).catch(() => {});
  }, []);

  const value = useMemo<AppState>(
    () => ({
      me,
      meError,
      epoch,
      setPersona,
      drawerId,
      openNode: (id) => setDrawerId(id),
      closeDrawer: () => setDrawerId(null),
      paletteOpen,
      setPaletteOpen,
      toast,
      say: setToast,
      tourOpen,
      openTour: () => setTourOpen(true),
      finishTour,
    }),
    [me, meError, epoch, setPersona, drawerId, paletteOpen, toast, tourOpen, finishTour],
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
