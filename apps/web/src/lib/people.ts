// Names and initials for people the app only knows by address.
import type { Me } from "../types";

/** "ada.lovelace@mantu.example" gives "Ada Lovelace". */
export function nameOfEmail(email: string | undefined | null): string {
  const local = (email ?? "").split("@")[0] ?? "";
  const words = local.split(/[._+-]+/).filter(Boolean);
  if (!words.length) return email ?? "";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function initialsOf(name: string): string {
  const w = name.split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  return ((w[0]?.[0] ?? "") + (w.length > 1 ? (w[w.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

export const displayName = (me: Me | null): string =>
  me ? (me.profile?.name ?? nameOfEmail(me.principal.email)) : "";
