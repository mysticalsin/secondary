import { Network } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n";
import { InsightCard, TwinTable } from "../../insights/InsightCard";
import { CARD } from "../../insights/palette";
import { pageLink } from "../../lib/links";
import { EmptyArt } from "./art";
import { clip, H, layoutGraph, W } from "./graph";
import type { GraphNode } from "./types";

const OTHER_BRAIN = "#0f9d94";

/** The pages one or two links away, inside brains this person can read. Others are not drawn at all. */
export function LocalGraph({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: { from: string; to: string }[];
}) {
  const { t, tn } = useI18n();
  const { placed, lines } = layoutGraph(nodes, edges);
  const centre = nodes.find((n) => n.hop === 0);
  const near = nodes.filter((n) => n.hop === 1).length;
  const far = nodes.filter((n) => n.hop === 2).length;
  const home = centre?.brainId;
  const others = new Set(nodes.map((n) => n.brainId)).size > 1;
  const summary = near
    ? t("v8l.graph.summary", {
        title: centre?.title ?? "",
        near,
        far,
      })
    : t("v8l.graph.none");
  const brainLabel = (n: GraphNode) => (n.brainId === "me" ? t("v4.personal") : n.brainName);
  return (
    <InsightCard
      testId="lens-graph"
      icon={<Network size={20} aria-hidden />}
      title={t("v8l.graph.title")}
      subtitle={t("v8l.graph.sub")}
      summary={summary}
      table={
        near ? (
          <TwinTable
            caption={t("v8l.graph.table")}
            head={[
              t("v5.table.page"),
              t("v5.table.collection"),
              t("v8l.table.brain"),
              t("v8l.table.distance"),
            ]}
            rows={nodes
              .filter((n) => n.hop > 0)
              .map((n) => [
                n.title,
                n.collection,
                brainLabel(n),
                tn(n.hop, "v8l.hop.one", "v8l.hop.other"),
              ])}
          />
        ) : undefined
      }
    >
      {near ? (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="lg8"
            role="group"
            aria-label={t("v8l.graph.group", { title: centre?.title ?? "" })}
          >
            <g className="lg8-lines" aria-hidden>
              {lines.map((l) => (
                <line key={l.k} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
              ))}
            </g>
            {placed.map((n) => {
              const right = n.x >= W / 2;
              const r = n.hop === 0 ? 9 : n.hop === 1 ? 6.5 : 4.5;
              const fill =
                n.hop === 0 ? CARD.yellow : n.brainId === home ? CARD.inZone : OTHER_BRAIN;
              const label = n.hop < 2 ? clip(n.title, n.hop === 0 ? 22 : 17) : "";
              const dx = r + 6;
              const node = (
                <>
                  <title>{`${n.title} (${n.collection}, ${brainLabel(n)})`}</title>
                  <circle className="lg8-hit" cx={n.x} cy={n.y} r={r + 7} />
                  <circle className="lg8-dot" cx={n.x} cy={n.y} r={r} fill={fill} />
                  {label ? (
                    <text
                      className={`lg8-t${n.hop === 0 ? " c" : ""}`}
                      x={n.hop === 0 ? n.x : n.x + (right ? dx : -dx)}
                      y={n.hop === 0 ? n.y + r + 15 : n.y + 4}
                      textAnchor={n.hop === 0 ? "middle" : right ? "start" : "end"}
                    >
                      {label}
                    </text>
                  ) : null}
                </>
              );
              return n.hop === 0 ? (
                <g key={n.key} className="lg8-n c" aria-current="page">
                  {node}
                </g>
              ) : (
                <Link
                  key={n.key}
                  className="lg8-n"
                  to={pageLink(n.brainId, n.id)}
                >
                  {node}
                </Link>
              );
            })}
          </svg>
          <ul className="lg8-key" aria-hidden>
            <li>
              <span className="k" style={{ background: CARD.yellow }} />
              {t("v8l.graph.key.this")}
            </li>
            <li>
              <span className="k" style={{ background: CARD.inZone }} />
              {t("v8l.graph.key.linked")}
            </li>
            {others ? (
              <li>
                <span className="k" style={{ background: OTHER_BRAIN }} />
                {t("v8l.graph.key.global")}
              </li>
            ) : null}
          </ul>
        </>
      ) : (
        <div className="lens-empty">
          <EmptyArt kind="graph" />
          <p>
            <b>{t("v8l.graph.none.t")}</b>
          </p>
          <p>{t("v8l.graph.none.l")}</p>
        </div>
      )}
    </InsightCard>
  );
}
