import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, setPersona as storePersona } from "./api";
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
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.me().then(
      (m) => {
        if (!live) return;
        setMe(m);
        setMeError(null);
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
    const t = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const setPersona = useCallback((id: string) => {
    storePersona(id);
    setDrawerId(null);
    setEpoch((e) => e + 1);
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
    }),
    [me, meError, epoch, setPersona, drawerId, paletteOpen, toast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
