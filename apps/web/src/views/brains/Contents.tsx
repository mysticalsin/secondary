import { ArrowRight, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Empty } from "../../components/ui";
import { useI18n } from "../../i18n";
import {
  type ContentNode,
  filterTree,
  pageMatches,
  type Contents as Tree,
} from "../../lib/contents";
import type { WikiPageRow } from "../wiki/types";
import { RowMenu } from "./RowMenu";

export interface Filters {
  term: string;
  type: string;
  status: "" | "published" | "draft";
  review: "" | "waiting" | "none";
}

export const NO_FILTER: Filters = { term: "", type: "", status: "", review: "" };
export const isFiltered = (f: Filters) => !!(f.term.trim() || f.type || f.status || f.review);

const pageHref = (brain: string, id: string) =>
  `/brains/${encodeURIComponent(brain)}/pages/${encodeURIComponent(id)}`;

function PageRow({
  brain,
  p,
  depth,
  waiting,
  loose,
}: {
  brain: string;
  p: WikiPageRow;
  depth: number;
  waiting: Set<string>;
  loose?: boolean;
}) {
  const { t } = useI18n();
  return (
    <li className="crow page" style={{ ["--d" as string]: depth }}>
      <div className="crow-main">
        <span className="spacer" aria-hidden />
        <FileText size={18} className="ic" aria-hidden />
        <div className="crow-text">
          <div className="crow-title">
            <Link to={pageHref(brain, p.id)}>{p.title}</Link>
            {loose && p.type === "overview" ? (
              <span className="tag">{t("v4.tag.overview")}</span>
            ) : null}
            {p.status === "draft" ? <span className="tag">{t("v4.tag.draft")}</span> : null}
            {waiting.has(p.id) ? <span className="tag attn">{t("v4.tag.waiting")}</span> : null}
          </div>
          {p.summary ? <div className="crow-sub clamp">{p.summary}</div> : null}
        </div>
        <Link
          className="go"
          to={pageHref(brain, p.id)}
          aria-label={t("v4.open.page", { name: p.title })}
        >
          <ArrowRight size={16} aria-hidden />
        </Link>
        <RowMenu label={p.title}>
          <Link role="menuitem" className="mi" to={pageHref(brain, p.id)}>
            {t("v4.menu.open")}
          </Link>
          <Link
            role="menuitem"
            className="mi"
            to={`/brains/${encodeURIComponent(brain)}/pages/${encodeURIComponent(p.id)}/versions`}
          >
            {t("v4.menu.history")}
          </Link>
        </RowMenu>
      </div>
    </li>
  );
}

function Branch({
  brain,
  node,
  depth,
  open,
  toggle,
  waiting,
  onAdd,
}: {
  brain: string;
  node: ContentNode;
  depth: number;
  open: Set<string>;
  toggle: (id: string) => void;
  waiting: Set<string>;
  onAdd: (type: string | null) => void;
}) {
  const { t, tn } = useI18n();
  if (node.kind === "page" && node.page)
    return <PageRow brain={brain} p={node.page} depth={depth} waiting={waiting} />;
  const isOpen = open.has(node.id);
  const Icon = isOpen ? FolderOpen : Folder;
  return (
    <>
      <li className="crow" style={{ ["--d" as string]: depth }}>
        <div className="crow-main">
          <button
            type="button"
            className="chev-btn"
            aria-expanded={isOpen}
            aria-label={t("v4.toggle", { name: node.label })}
            onClick={() => toggle(node.id)}
          >
            <ChevronRight size={16} className={`chev${isOpen ? " down" : ""}`} aria-hidden />
          </button>
          <Icon size={18} className="ic folder" aria-hidden />
          <div className="crow-text">
            <div className="crow-title">
              <button type="button" className="rowname" onClick={() => toggle(node.id)}>
                {node.label}
              </button>
            </div>
            <div className="crow-sub">{tn(node.count, "b3.pages.one", "b3.pages.other")}</div>
          </div>
          <span className="kindtag">
            {node.kind === "collection" ? t("v4.kind.collection") : t("v4.kind.folder")}
          </span>
          <RowMenu label={node.label}>
            {node.kind === "collection" && node.id.startsWith("collection:") ? (
              <button
                type="button"
                role="menuitem"
                className="mi"
                onClick={() => onAdd(node.id.slice("collection:".length))}
              >
                {t("v4.menu.addhere")}
              </button>
            ) : null}
            <button type="button" role="menuitem" className="mi" onClick={() => toggle(node.id)}>
              {isOpen ? t("v4.menu.collapse") : t("v4.menu.expand")}
            </button>
          </RowMenu>
        </div>
      </li>
      {isOpen ? (
        node.children.length ? (
          node.children.map((c) => (
            <Branch
              key={c.id}
              brain={brain}
              node={c}
              depth={depth + 1}
              open={open}
              toggle={toggle}
              waiting={waiting}
              onAdd={onAdd}
            />
          ))
        ) : (
          <li className="crow empty-row" style={{ ["--d" as string]: depth + 1 }}>
            <span className="muted">{t("v4.collection.empty")}</span>
          </li>
        )
      ) : null}
    </>
  );
}

/** The brain's contents: collections that open in place into folders and pages, then loose pages. */
export function ContentsList({
  brain,
  tree,
  filters,
  waiting,
  onAdd,
}: {
  brain: string;
  tree: Tree;
  filters: Filters;
  waiting: Set<string>;
  onAdd: (type: string | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const filtered = isFiltered(filters);
  const shown = useMemo(() => {
    const keep = (p: WikiPageRow) =>
      pageMatches(p, filters.term) &&
      (!filters.type || p.type === filters.type) &&
      (!filters.status || (p.status ?? "published") === filters.status) &&
      (!filters.review || (filters.review === "waiting" ? waiting.has(p.id) : !waiting.has(p.id)));
    if (!filtered) return { collections: tree.collections, loose: tree.loose };
    return {
      collections: filterTree(tree.collections, keep, false),
      loose: tree.loose.filter(keep),
    };
  }, [tree, filters, filtered, waiting]);
  const allOpen = useMemo(() => {
    const s = new Set<string>();
    const walk = (n: ContentNode) => {
      if (n.kind !== "page") s.add(n.id);
      for (const c of n.children) walk(c);
    };
    for (const c of shown.collections) walk(c);
    return s;
  }, [shown.collections]);
  const openSet = filtered ? allOpen : open;
  if (!shown.collections.length && !shown.loose.length)
    return (
      <Empty title={filtered ? t("v4.contents.nomatch") : t("v4.contents.empty")}>
        {filtered ? t("v4.contents.nomatch.lead") : t("v4.contents.empty.lead")}
      </Empty>
    );
  return (
    <ul className="contents" aria-label={t("v4.contents")}>
      {shown.collections.map((c) => (
        <Branch
          key={c.id}
          brain={brain}
          node={c}
          depth={0}
          open={openSet}
          toggle={toggle}
          waiting={waiting}
          onAdd={onAdd}
        />
      ))}
      {shown.loose.map((p) => (
        <PageRow key={p.id} brain={brain} p={p} depth={0} waiting={waiting} loose />
      ))}
    </ul>
  );
}
