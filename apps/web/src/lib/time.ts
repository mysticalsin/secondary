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
