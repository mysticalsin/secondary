import {
  type ACTIONS,
  type AdmittedView,
  admittedView,
  buildOrg,
  type Ctx,
  canDo,
  type Hub,
  LENSES,
  type Lens,
  type MapNode,
  type MapView,
  PERSONAS,
  type RoleId,
  toMapView,
} from "../src/index.ts";

export const org = buildOrg();
export const NOW = Date.UTC(2026, 10, 4, 12);
export const HOUR = 3_600_000;
export const ctx = (extra: Partial<Ctx> = {}): Ctx => ({ now: NOW, ...extra });
export const view = (r: RoleId, c: Ctx = ctx()): AdmittedView => admittedView(PERSONAS[r], org, c);
export const can = (r: RoleId, id: string, action: (typeof ACTIONS)[number], c: Ctx = ctx()) =>
  canDo(PERSONAS[r], org, id, action, c);

export const accountsOf = (v: AdmittedView) =>
  [...v.nodes.values()].filter((n) => n.kind === "account");

export function mapNodes(mv: MapView): (MapNode | Hub)[] {
  const out: (MapNode | Hub)[] = [];
  const walk = (n: MapNode | Hub) => {
    out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  for (const h of mv.hubs) walk(h);
  return out;
}

export const allMapNodes = (v: AdmittedView, lenses: readonly Lens[] = LENSES) =>
  lenses.flatMap((l) => mapNodes(toMapView(v, l)));
