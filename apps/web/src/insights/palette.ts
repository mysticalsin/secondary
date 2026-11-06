// Colours of the instrument cards (docs/DESIGN-V5-BRAIN-INSIGHTS.md section 1). The cards are dark
// in both themes, on purpose. Every pair below was checked for text contrast against the card (7:1
// or better for text, 3:1 for marks) and the categories also differ by label, never by colour alone.

export const CARD = {
  bg: "#1e1e22",
  line: "#2a2a30",
  ink: "#f4f3f7",
  mute: "#a6a4b2",
  faint: "#8a8896",
  grid: "#34343c",
  inZone: "#8b5cf6",
  inZoneDeep: "#7f00da",
  below: "#7f7f8b",
  yellow: "#f8f060",
} as const;

/** One entry per category: a fill for avatars and bars (white text on it), a chip background and text. */
export const CATEGORY = [
  { fill: "#5b3fd0", bar: "#8b5cf6", chipBg: "#3a2a8c", chipFg: "#e3dbff", chipCount: "#5340b0" },
  { fill: "#0f766e", bar: "#14b8a6", chipBg: "#0f4f4a", chipFg: "#a7f3e6", chipCount: "#17706a" },
  { fill: "#a21c61", bar: "#db2777", chipBg: "#7a1b4b", chipFg: "#fbd0e6", chipCount: "#9a2d66" },
  { fill: "#92590a", bar: "#f59e0b", chipBg: "#6d4308", chipFg: "#fde9b0", chipCount: "#8a5a14" },
  { fill: "#2742a8", bar: "#3b5bdb", chipBg: "#233a92", chipFg: "#cdd6ff", chipCount: "#3b52b0" },
] as const;

export const cat = (n: number) =>
  CATEGORY[
    ((n % CATEGORY.length) + CATEGORY.length) % CATEGORY.length
  ] as (typeof CATEGORY)[number];

/** Source kinds keep one colour each across the sources bar and the table. */
export const SOURCE_COLOR: Record<string, string> = {
  sharepoint: "#5b7cff",
  meetings: "#2dd4bf",
  agents: "#ec4899",
  manual: "#f59e0b",
  import: "#a78bfa",
};

/** Funnel stages, in order: neutral, blue, teal, indigo, amber (as in the reference). */
export const STAGE_FILL = ["#3a3a40", "#2742a8", "#0f766e", "#4f35c9", "#92590a"] as const;
