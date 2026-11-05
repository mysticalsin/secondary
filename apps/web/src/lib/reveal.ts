import { useEffect, useState } from "react";

/** True when the person asked for less motion. Without matchMedia (tests) we also skip motion. */
export function reducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Reveals `text` word by word. With reduced motion the whole text is there at once. */
export function useReveal(text: string, enabled: boolean): { shown: string; revealing: boolean } {
  const words = text.split(/(\s+)/);
  const [n, setN] = useState(() => (enabled && !reducedMotion() ? 0 : words.length));
  useEffect(() => {
    if (!enabled || reducedMotion()) {
      setN(words.length);
      return;
    }
    setN(0);
    const id = window.setInterval(() => {
      setN((v) => {
        if (v + 2 >= words.length) {
          window.clearInterval(id);
          return words.length;
        }
        return v + 2;
      });
    }, 24);
    return () => window.clearInterval(id);
  }, [text, enabled, words.length]);
  return { shown: words.slice(0, n).join(""), revealing: n < words.length };
}
