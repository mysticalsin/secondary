import type { ReactNode } from "react";
import { getLang, useI18n, useT } from "../i18n";
import type { Plane } from "../types";
import type { Async } from "../useApi";

/** Revisions are integers on the wire. People read them as r3. */
export function fmtRev(v: string | number): string {
  return `r${v}`;
}

export function PlaneBadge({ plane }: { plane: Plane }) {
  const { td } = useI18n();
  return <span className={`chip plane-${plane}`}>{td("plane", plane, plane)}</span>;
}

/** A status the server sends as a word (open, in progress, approved), in the viewer's language. */
export function useStatus(): (s: string) => string {
  const { td } = useI18n();
  return (s) => td("status", s.toLowerCase(), s);
}

export function Chip({
  tone,
  children,
}: {
  tone?: "open" | "progress" | "done" | "risk" | "attn";
  children: ReactNode;
}) {
  return <span className={`chip t-${tone ?? "open"}`}>{children}</span>;
}

export function statusTone(s: string): "open" | "progress" | "done" | "risk" | "attn" {
  const v = s.toLowerCase();
  if (/(approved|done|decided|deployed|active|allowed|supported)/.test(v)) return "done";
  if (/(progress|candidate|captured|renewal|onboarding|partial)/.test(v)) return "progress";
  if (/(overdue|risk|unsupported|not allowed|paused|denied)/.test(v)) return "risk";
  if (/(open|draft|watch|unknown)/.test(v)) return "open";
  return "open";
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

const SKELETON_KEYS = ["a", "b", "c", "d", "e", "f"];

export function Skeleton({ n = 3 }: { n?: number }) {
  const t = useT();
  return (
    <div className="stack" aria-busy="true" role="status">
      <span className="sr-only">{t("common.loading")}</span>
      {SKELETON_KEYS.slice(0, n).map((k) => (
        <div className="skeleton" key={k} />
      ))}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="errorbox" role="alert">
      <div>{message}</div>
      {onRetry ? (
        <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={onRetry}>
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}

/** Renders loading, error and data states for a useApi result. */
export function Await<T>({
  state,
  children,
  skeleton = 3,
}: {
  state: Async<T>;
  children: (d: T) => ReactNode;
  skeleton?: number;
}) {
  if (state.loading && !state.data) return <Skeleton n={skeleton} />;
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />;
  if (!state.data) return null;
  return <>{children(state.data)}</>;
}

export function PageHead({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <header className="page-head">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2>{title}</h2>
      {lead ? <p>{lead}</p> : null}
    </header>
  );
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(getLang() === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "medium",
    timeZone: "America/Toronto",
  }).format(d);
}
