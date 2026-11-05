import { STAGES, type Stage, type UseCase } from "../types";
import { Chip, statusTone } from "./ui";

export const STAGE_COLOR: Record<Stage, string> = {
  Discover: "var(--mat-discover)",
  "In design": "var(--mat-design)",
  Building: "var(--mat-building)",
  Piloting: "var(--mat-piloting)",
  Deployed: "var(--mat-deployed)",
};

export function StageBoard({
  useCases,
  onOpen,
  limit,
}: {
  useCases: UseCase[];
  onOpen: (id: string) => void;
  limit?: number;
}) {
  return (
    <div className="board" role="list" aria-label="Use cases by stage">
      {STAGES.map((s) => {
        const list = useCases.filter((u) => u.stage === s);
        const shown = limit ? list.slice(0, limit) : list;
        const id = `stage-${s.replace(/\s/g, "-")}`;
        return (
          <section
            className="col"
            role="listitem"
            key={s}
            aria-labelledby={id}
            style={{ ["--c" as string]: STAGE_COLOR[s] }}
          >
            <header>
              <span id={id}>{s}</span>
              <span className="num muted">{list.length}</span>
            </header>
            <ul>
              {shown.map((u) => (
                <li key={u.id}>
                  <button type="button" className="ucard" onClick={() => onOpen(u.id)}>
                    <div>{u.title}</div>
                    <Chip tone={statusTone(u.evidence)}>{u.evidence}</Chip>
                  </button>
                </li>
              ))}
              {list.length > shown.length ? (
                <li className="muted" style={{ padding: "4px 6px", fontSize: 13 }}>
                  and {list.length - shown.length} more
                </li>
              ) : null}
              {list.length === 0 ? (
                <li className="muted" style={{ padding: 8, fontSize: 14 }}>
                  None yet.
                </li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
