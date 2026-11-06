// My Home: the person's pinned views on a 12-column grid. Drag the grip to move, drag the corner to
// resize, or use the keyboard (arrows move, Shift and arrows resize). Layout is saved with
// PUT /v1/views/:id; the plans are re-resolved for the viewer each time they open.
import { GripVertical, MoveDiagonal2, Sparkles } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Await } from "../components/ui";
import { useI18n } from "../i18n";
import { useApi } from "../useApi";
import {
  type Cell,
  cellOf,
  type Dir,
  moveBy,
  place,
  resizeBy,
  resolve,
  withDefaults,
} from "./grid";
import { useAgentHost } from "./host";
import { ViewCard } from "./ViewCard";
import { type SavedView, viewsApi } from "./views";
import "./agent.css";

const ROW = 72;
const GAP = 16;
const DIRS: Record<string, Dir> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

function Grid({ views, reload }: { views: SavedView[]; reload: () => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState(views);
  const [cells, setCells] = useState<Cell[]>(() => withDefaults(views));
  const [said, setSaid] = useState("");
  const saved = useRef(new Map<string, string>());
  const timer = useRef<number | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    kind: "move" | "size";
    sx: number;
    sy: number;
    from: Cell;
  } | null>(null);
  const latest = useRef(cells);
  latest.current = cells;

  useEffect(() => {
    setItems(views);
    const c = withDefaults(views);
    setCells(c);
    saved.current = new Map(
      views.map((v) => [
        v.id,
        v.layout ? `${v.layout.x},${v.layout.y},${v.layout.w},${v.layout.h}` : "",
      ]),
    );
  }, [views]);

  const persist = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      for (const c of latest.current) {
        const sig = `${c.x},${c.y},${c.w},${c.h}`;
        if (saved.current.get(c.id) === sig) continue;
        saved.current.set(c.id, sig);
        viewsApi.update(c.id, { layout: { x: c.x, y: c.y, w: c.w, h: c.h } }).catch(() => {
          saved.current.delete(c.id);
        });
      }
    }, 350);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const announce = (next: Cell[], id: string) => {
    const c = next.find((x) => x.id === id);
    const v = items.find((x) => x.id === id);
    if (c && v) setSaid(t("v6.grid.pos", { name: v.name, x: c.x + 1, y: c.y + 1, w: c.w, h: c.h }));
  };

  const onKey = (e: KeyboardEvent<HTMLElement>, id: string) => {
    if (e.target !== e.currentTarget) return;
    const dir = DIRS[e.key];
    if (!dir) return;
    e.preventDefault();
    const next = e.shiftKey ? resizeBy(cells, id, dir) : moveBy(cells, id, dir);
    setCells(next);
    latest.current = next;
    announce(next, id);
    persist();
  };

  const down = (e: PointerEvent<HTMLElement>, id: string, kind: "move" | "size") => {
    const from = cells.find((c) => c.id === id);
    if (!from) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id, kind, sx: e.clientX, sy: e.clientY, from };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const w = grid.current?.clientWidth;
    if (!d || !w) return;
    const dx = cellOf(e.clientX - d.sx, w, GAP);
    const dy = Math.round((e.clientY - d.sy) / (ROW + GAP));
    const base =
      d.kind === "move"
        ? { ...d.from, x: d.from.x + dx, y: d.from.y + dy }
        : { ...d.from, w: d.from.w + dx, h: d.from.h + dy };
    setCells(place(cells, base));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    announce(latest.current, d.id);
    persist();
  };

  const order = useMemo(() => [...cells].sort((a, b) => a.y - b.y || a.x - b.x), [cells]);
  const rows = Math.max(1, ...cells.map((c) => c.y + c.h));
  return (
    <>
      <p className="muted small">{t("v6.grid.hint")}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
      <div
        ref={grid}
        className="ag-grid12"
        role="group"
        aria-label={t("v6.grid.label")}
        style={{ "--rows": `repeat(${rows}, ${ROW}px)` } as CSSProperties}
        data-testid="agent-grid"
      >
        {order.map((c) => {
          const v = items.find((x) => x.id === c.id);
          if (!v) return null;
          return (
            <div
              key={c.id}
              className="ag-cell"
              role="group"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: the cell is the keyboard handle for move and resize
              tabIndex={0}
              aria-label={t("v6.grid.card", { name: v.name })}
              style={
                {
                  "--col": `${c.x + 1} / span ${c.w}`,
                  "--row": `${c.y + 1} / span ${c.h}`,
                } as CSSProperties
              }
              onKeyDown={(e) => onKey(e, c.id)}
              data-testid="agent-cell"
            >
              <ViewCard
                view={v}
                onChanged={(nv) => {
                  if (!nv) {
                    if (items.length <= 1) reload();
                    setItems((all) => all.filter((x) => x.id !== v.id));
                    setCells((all) => resolve(all.filter((x) => x.id !== v.id)));
                    persist();
                    return;
                  }
                  setItems((all) =>
                    all.map((x) => (x.id === nv.id ? { ...nv, tree: nv.tree ?? x.tree } : x)),
                  );
                }}
                headExtra={
                  <button
                    type="button"
                    className="ag-grip"
                    aria-label={t("v6.grid.drag", { name: v.name })}
                    onPointerDown={(e) => down(e, c.id, "move")}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={up}
                  >
                    <GripVertical size={16} aria-hidden />
                  </button>
                }
              />
              <button
                type="button"
                className="ag-size"
                aria-label={t("v6.grid.handle", { name: v.name })}
                onPointerDown={(e) => down(e, c.id, "size")}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onKeyDown={(e) => {
                  const dir = DIRS[e.key];
                  if (!dir) return;
                  e.preventDefault();
                  const next = resizeBy(cells, c.id, dir);
                  setCells(next);
                  latest.current = next;
                  announce(next, c.id);
                  persist();
                }}
              >
                <MoveDiagonal2 size={14} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** The My Home section. Without pins it invites the first one. */
export default function PinnedGrid() {
  const { t } = useI18n();
  const { setOpen } = useAgentHost();
  const state = useApi(() => viewsApi.list("home"), []);
  return (
    <section className="hsec ag-home" aria-labelledby="ag-home-h" data-testid="agent-home">
      <div className="sec-head">
        <div>
          <h2 id="ag-home-h">{t("v6.home.title")}</h2>
          <p className="muted">{t("v6.home.lead")}</p>
        </div>
      </div>
      <Await state={state} skeleton={2}>
        {(views) =>
          views.length ? (
            <Grid views={views} reload={state.reload} />
          ) : (
            <div className="empty ag-empty">
              <h3>{t("v6.home.empty")}</h3>
              <p>{t("v6.home.empty.lead")}</p>
              <button type="button" className="btn primary" onClick={() => setOpen(true)}>
                <Sparkles size={15} aria-hidden /> {t("v6.home.ask")}
              </button>
            </div>
          )
        }
      </Await>
    </section>
  );
}
