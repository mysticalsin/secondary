import { getLang } from "../i18n";

/** "3 h ago", "1 d ago", in the viewer's language. Toronto time is not needed for an age. */
export function ago(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const rtf = new Intl.RelativeTimeFormat(getLang() === "fr" ? "fr-CA" : "en-CA", {
    numeric: "auto",
    style: "narrow",
  });
  const s = Math.round((ms - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86_400), "day");
}

// ---- Times in the viewer's own time zone (the browser's, through Intl). ----
// Servers send ISO instants (UTC). Everything a person reads is shown where they are. `tz` is only for
// tests and for a place that must name a zone; by default the browser's zone is used.

export interface Local {
  y: number;
  mo: number; // 1 to 12
  d: number;
  h: number; // 0 to 23
  mi: number;
  s: number;
}

const partsFmt = (tz?: string) =>
  new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
    ...(tz ? { timeZone: tz } : {}),
  });

/** The calendar fields of an instant in the viewer's zone, or null for something that is not a date. */
export function localParts(iso: string, tz?: string): Local | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const p = Object.fromEntries(
    partsFmt(tz)
      .formatToParts(ms)
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  return {
    y: p.year as number,
    mo: p.month as number,
    d: p.day as number,
    h: (p.hour as number) % 24,
    mi: p.minute as number,
    s: p.second as number,
  };
}

const two = (n: number) => String(n).padStart(2, "0");

/** `11:04` in the viewer's zone. */
export const localHm = (iso: string, tz?: string): string => {
  const l = localParts(iso, tz);
  return l ? `${two(l.h)}:${two(l.mi)}` : iso;
};

/** `11:04:09` in the viewer's zone. */
export const localHms = (iso: string, tz?: string): string => {
  const l = localParts(iso, tz);
  return l ? `${two(l.h)}:${two(l.mi)}:${two(l.s)}` : iso;
};

/** The viewer's zone, short and readable: `EST`, `GMT+7`. Empty when the browser cannot say. */
export function zoneName(at: number = Date.now(), tz?: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZoneName: "short", ...(tz ? { timeZone: tz } : {}) })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}
