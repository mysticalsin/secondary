// The small part of My Agent that lives in the main bundle: whether the panel is open, the
// Cmd/Ctrl+J shortcut, the top-bar button, and a queue for a turn that another part of the app asks
// for (a button on a pinned card). The panel itself, the parser and Zod load on first use.
import { Sparkles } from "lucide-react";
import "./button.css";
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "../i18n";

export interface PendingTurn {
  n: number;
  /** What the person sees in the thread. */
  label: string;
  text?: string;
  action?: { action: string; values: Record<string, string> };
}

interface Host {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  /** Open the panel and send a turn into it. */
  ask: (t: Omit<PendingTurn, "n">) => void;
  pending: PendingTurn | null;
  take: (n: number) => void;
}

const Ctx = createContext<Host>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
  ask: () => {},
  pending: null,
  take: () => {},
});

export const useAgentHost = (): Host => useContext(Ctx);
export const PANEL_ID = "agent-panel";

export function AgentHostProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const seq = useRef(0);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const ask = useCallback((t: Omit<PendingTurn, "n">) => {
    seq.current += 1;
    setPending({ ...t, n: seq.current });
    setOpen(true);
  }, []);
  const take = useCallback((n: number) => setPending((p) => (p?.n === n ? null : p)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  const value = useMemo(
    () => ({ open, setOpen, toggle, ask, pending, take }),
    [open, toggle, ask, pending, take],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The top-bar button. It carries the state of the panel and the shortcut. */
export function AgentButton() {
  const { t } = useI18n();
  const { open, toggle } = useAgentHost();
  return (
    <button
      type="button"
      className="agent-btn"
      aria-expanded={open}
      aria-controls={PANEL_ID}
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+J Meta+J"
      title={`${t("v6.open")} (Ctrl+J)`}
      onClick={toggle}
      data-testid="agent-button"
    >
      <Sparkles size={16} aria-hidden />
      <span>{t("v6.agent")}</span>
    </button>
  );
}

const Panel = lazy(() => import("./AgentPanel"));

/** Mounts the panel the first time it opens and keeps it, so a stream keeps running when it closes. */
export function AgentPanelSlot() {
  const { open } = useAgentHost();
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (open) setSeen(true);
  }, [open]);
  if (!seen) return null;
  return (
    <Suspense fallback={null}>
      <Panel />
    </Suspense>
  );
}
