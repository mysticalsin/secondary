import { useEffect, useState } from "react";
import { type AgentSettings, readHistory, readSettings, SETTINGS_EVENT } from "./settings";

/** The device settings, kept in step with changes made elsewhere on the page. */
export function useAgentSettings(): AgentSettings {
  const [s, setS] = useState(readSettings);
  useEffect(() => {
    const on = () => setS(readSettings());
    window.addEventListener(SETTINGS_EVENT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  return s;
}

export function useHistoryCount(): number {
  const [n, setN] = useState(() => readHistory().length);
  useEffect(() => {
    const on = () => setN(readHistory().length);
    window.addEventListener(SETTINGS_EVENT, on);
    return () => window.removeEventListener(SETTINGS_EVENT, on);
  }, []);
  return n;
}
