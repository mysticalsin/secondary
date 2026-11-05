import { ChevronRight, FileText, Folder, Lock } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useI18n } from "../../i18n";
import type { TreeNode } from "../../uxv2/types";

export interface Selected {
  ws: string;
  page: string | null;
  folder: string | null;
}

/** Folder id to the workspace it belongs to ("core/bid" has workspace "core"). */
export const wsOfFolder = (id: string): string => id.split("/")[0] ?? id;

interface Props {
  groups: { key: string; title: string; nodes: TreeNode[] }[];
  selected: Selected | null;
  onPage: (ws: string, id: string) => void;
  onFolder: (ws: string, id: string) => void;
}

function Row({
  node,
  ws,
  depth,
  p,
  open,
  toggle,
}: {
  node: TreeNode;
  ws: string;
  depth: number;
  p: Props;
  open: Set<string>;
  toggle: (id: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const key = `${ws}:${node.id}`;
  if (node.access === "locked") {
    return (
      <li key={key} className="bt-locked" data-testid="tree-locked">
        <span className="bt-row" title={t("brain.locked.hint")}>
          <Lock size={14} aria-hidden />
          <span>{node.label}</span>
          <span className="sr-only">{t("brain.locked")}</span>
        </span>
      </li>
    );
  }
  if (node.kind === "page") {
    const on = p.selected?.ws === ws && p.selected.page === node.id;
    return (
      <li key={key}>
        <button
          type="button"
          className="bt-row bt-page"
          aria-current={on ? "page" : undefined}
          onClick={() => p.onPage(ws, node.id)}
        >
          <FileText size={14} aria-hidden />
          <span>{node.label}</span>
        </button>
      </li>
    );
  }
  const isOpen = open.has(key);
  const on = p.selected?.folder === node.id;
  return (
    <li key={key}>
      <button
        type="button"
        className={`bt-row bt-folder${on ? " on" : ""}`}
        aria-expanded={isOpen}
        onClick={() => {
          toggle(key);
          if (node.kind === "folder") p.onFolder(ws, node.id);
        }}
      >
        <ChevronRight size={14} className="bt-chev" aria-hidden />
        {node.kind === "folder" ? <Folder size={14} aria-hidden /> : null}
        <span>{node.label}</span>
        {node.count != null ? <span className="bt-n num">{node.count}</span> : null}
      </button>
      {isOpen && node.children?.length ? (
        <ul style={{ ["--depth" as string]: depth + 1 }}>
          {node.children.map((c) => (
            <Row
              key={`${ws}:${c.id}`}
              node={c}
              ws={ws}
              depth={depth + 1}
              p={p}
              open={open}
              toggle={toggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function BrainTree(p: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const g of p.groups) for (const w of g.nodes) s.add(`${w.id}:${w.id}`);
    if (p.selected) {
      s.add(`${p.selected.ws}:${p.selected.ws}`);
      if (p.selected.folder) s.add(`${p.selected.ws}:${p.selected.folder}`);
    }
    return s;
  });
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <nav className="btree" aria-label={t("brain.tree")}>
      {p.groups.map((g) => (
        <section key={g.key} aria-labelledby={`bt-${g.key}`}>
          <h3 id={`bt-${g.key}`} className="bt-root">
            {g.title}
          </h3>
          {g.nodes.length ? (
            <ul>
              {g.nodes.map((w) => (
                <Row key={w.id} node={w} ws={w.id} depth={0} p={p} open={open} toggle={toggle} />
              ))}
            </ul>
          ) : (
            <p className="muted bt-empty">{t("brain.root.empty")}</p>
          )}
        </section>
      ))}
    </nav>
  );
}
