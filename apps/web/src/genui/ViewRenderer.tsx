import { Component, type ComponentType, type ReactNode } from "react";
import type { CatalogType } from "../types";
import {
  AccountSummary,
  Callout,
  ItemList,
  KpiRow,
  MapMini,
  NodeCard,
  StageBoardBlock,
  TableBlock,
} from "./components";
import { sanitizePlan } from "./plan";

type P = Record<string, unknown>;
const REGISTRY: Record<CatalogType, ComponentType<{ props: P }>> = {
  KpiRow,
  NodeCard,
  ItemList,
  AccountSummary,
  StageBoard: StageBoardBlock,
  MapMini,
  Callout,
  Table: TableBlock,
};

class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed)
      return (
        <div className="errorbox" role="alert">
          This block could not be shown.
        </div>
      );
    return this.props.children;
  }
}

/** Renders a ViewPlan with the trusted catalog only. Each block fetches its own data as the viewer. */
export function ViewRenderer({ plan }: { plan: unknown }) {
  const clean = sanitizePlan(plan);
  if (!clean) {
    return (
      <div className="errorbox" role="alert">
        The view plan was not valid, so nothing was drawn.
      </div>
    );
  }
  return (
    <section className="gen" aria-label={clean.title} data-testid="view-plan">
      <h3>{clean.title}</h3>
      {clean.components.map((c, i) => {
        const Cmp = REGISTRY[c.type as CatalogType];
        return (
          // Plans are static once rendered, so index keys are stable.
          <Guard key={i}>
            <Cmp props={c.props} />
          </Guard>
        );
      })}
    </section>
  );
}
