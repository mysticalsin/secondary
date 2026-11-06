import { type RefObject, useEffect, useId, useState } from "react";
import { useI18n } from "../i18n";

/** A stable id for aria links. */
export const useUid = (): string => useId().replace(/:/g, "");

export function useNumber(): (n: number, o?: Intl.NumberFormatOptions) => string {
  const { locale } = useI18n();
  return (n, o) => new Intl.NumberFormat(locale, o).format(n);
}

export function useDate(): (iso: string, o?: Intl.DateTimeFormatOptions) => string {
  const { locale } = useI18n();
  return (iso, o) => {
    const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC", ...o }).format(
      d,
    );
  };
}

/** An instant as a date in the viewer's own time zone (the lens facts); `useDate` is for calendar days. */
export function useLocalDate(): (iso: string, o?: Intl.DateTimeFormatOptions) => string {
  const { locale } = useI18n();
  return (iso, o) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", ...o }).format(new Date(iso));
}

/** Width in CSS pixels of an element, kept up to date. 0 until measured. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((e) => setW(Math.round(e[0]?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Two letters from a title: "Pricing method" gives "PM". */
export function initials(text: string): string {
  const w = text
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  const a = w[0]?.[0] ?? "?";
  const b = w.length > 1 ? (w[1]?.[0] ?? "") : (w[0]?.[1] ?? "");
  return `${a}${b}`.toUpperCase();
}
