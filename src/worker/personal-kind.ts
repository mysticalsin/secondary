// The kind of a Personal Brain item. Items created through the API carry it as a tag; seeded items
// carry it in the label prefix.

export type PersonalKind = "note" | "brief" | "view" | "draft";
export const PERSONAL_KINDS: readonly string[] = ["note", "brief", "view", "draft"];

export function personalKindOf(label: string, tags: readonly string[]): PersonalKind {
  const tag = tags.find((t) => PERSONAL_KINDS.includes(t));
  if (tag) return tag as PersonalKind;
  const l = label.toLowerCase();
  if (l.startsWith("private brief")) return "brief";
  if (l.startsWith("saved view")) return "view";
  if (l.startsWith("draft")) return "draft";
  return "note";
}
