// The five pulse categories keep one colour each, in this order, on every card. Checked with the
// dataviz validator against the card surface #1e1e22 in dark mode: lightness band, chroma floor,
// adjacent colour-vision separation (worst 11.9 under deutan, target 8), normal-vision floor (20.7
// against 15) and contrast against the surface (3:1 or better). Cards are dark in both themes.
import type { Category } from "./types";

export const PULSE_COLOR: Record<Category, string> = {
  published: "#8b5cf6",
  resolved: "#0f9d94",
  sources: "#c2820a",
  gaps: "#d6336c",
  rules: "#3b82f6",
};

const DAY = 86_400_000;

/** Every calendar day from `from` to `to`, oldest first (UTC dates, as the journal is written). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += DAY)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
