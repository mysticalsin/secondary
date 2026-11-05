import { useMemo } from "react";
import { useI18n } from "../../i18n";
import { nameOfEmail } from "../../lib/people";
import { whoIs } from "../../personas";
import { useApi } from "../../useApi";
import type { Question } from "../../uxv2/types";
import { v3 } from "../brains/api";

/** Brain id to a display name, from the nav the sidebar shows. The Personal Brain is `me`. */
export function useBrainNames(): (id: string) => string {
  const { t } = useI18n();
  const nav = useApi(() => v3.nav(), []);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of nav.data?.items ?? []) {
      m.set(i.id, i.name);
      for (const c of i.children ?? []) m.set(c.id, c.name);
    }
    return m;
  }, [nav.data]);
  return (id) => (id === "me" ? t("v4.personal") : (names.get(id) ?? id));
}

/** Who wrote a waiting item, for people ("u_head_bid" shows the role) and for agents. */
export function useAuthor(): (q: Question) => string {
  const { t, td } = useI18n();
  return (q) => {
    const id = q.detail?.authorId;
    if (!id) return "";
    if (id.startsWith("svc:")) return t("wiki.agent");
    if (id.includes("@")) return nameOfEmail(id);
    return whoIs(id, (r, f) => td("role", r, f));
  };
}

/** A diff with at least one changed line. "New page" when nothing existed before. */
export function isNewPage(q: Question): boolean {
  const pages = q.detail?.pages ?? [];
  return pages.length > 0 && pages.every((p) => p.diff.every((l) => l.type === "add"));
}
