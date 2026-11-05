import type { ResolvedComponent, ResolvedView } from "./resolve.ts";

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const cell = (v: unknown) =>
  v === null || v === undefined ? "-" : String(v).replace(/[|\n\r]/g, " ");

const STATUS_TEXT: Record<string, string> = {
  denied: "_Not available to you (no access)._",
  missing: "_Not found._",
  error: "_Could not be loaded._",
};

function component(c: ResolvedComponent): string {
  if (c.status !== "ok" || !c.data) return `### ${c.type}\n${STATUS_TEXT[c.status] ?? ""}`;
  const d = c.data as Json;
  switch (c.type) {
    case "Callout":
      return `> ${cell(d.message)}`;
    case "KpiRow":
      return `### ${cell(d.label)}\n${
        d.locked
          ? "_Locked._"
          : arr(d.metrics)
              .map((m) => `${cell(m.label)}: ${cell(m.value)}`)
              .join(" | ")
      }`;
    case "NodeCard": {
      const cn = (d.counts ?? null) as Json | null;
      const counts = cn
        ? ` (${["items", "topics", "open", "gaps"].map((k) => `${k} ${cell(cn[k])}`).join(", ")})`
        : " (locked)";
      return `### ${cell(d.label)}\n${cell(d.kind)} / ${cell(d.plane)} / access ${cell(d.access)}${counts}`;
    }
    case "ItemList": {
      const items = arr(d.items);
      return `### ${cell(d.label)}: items\n${
        items.length
          ? items
              .map(
                (i) =>
                  `- ${cell(i.title)} (rev ${cell(i.revision)}, ${cell(i.evidence)}, ${cell(i.source)})`,
              )
              .join("\n")
          : "_No items._"
      }`;
    }
    case "AccountSummary":
      return `### ${cell(d.label)}\n${arr(d.sections)
        .map((s) => `- ${cell(s.label)}${s.count ? ` (${cell(s.count)})` : ""}`)
        .join("\n")}`;
    case "StageBoard":
      return `### Stages\n${arr(d.governances)
        .map(
          (g) =>
            `- ${cell(g.label)}: ${arr(g.stages)
              .map((s) => `${cell(s.stage)} ${cell(s.count)}`)
              .join(", ")}`,
        )
        .join("\n")}`;
    case "MapMini":
      return `### Map (${cell(d.lens)})\n${arr(d.hubs)
        .map((h) => `- ${cell(h.label)} [${cell(h.kind)}, ${cell(h.access)}]`)
        .join("\n")}`;
    case "Table": {
      const cols = (d.columns as string[]) ?? [];
      const head = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
      const body = arr(d.rows)
        .map((r) => `| ${cols.map((k) => cell(r[k])).join(" | ")} |`)
        .join("\n");
      return `${head}\n${body}`;
    }
  }
}

/** Concise markdown for hosts without MCP Apps support (and for the model's own context). */
export function viewToMarkdown(view: ResolvedView): string {
  const parts = [`## ${view.title}`, ...view.components.map(component)];
  if (view.dropped.length) {
    parts.push(
      `_Dropped ${view.dropped.length} component(s) not in the catalog: ${view.dropped.map((d) => d.type).join(", ")}._`,
    );
  }
  return parts.join("\n\n");
}
