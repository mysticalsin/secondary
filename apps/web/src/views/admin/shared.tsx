import { type ReactNode, useCallback, useState } from "react";
import { ApiError } from "../../api";
import { ErrorBox } from "../../components/ui";
import { whoIs } from "../../personas";
import { useApp } from "../../state";
import type { Change } from "./api";

/** Runs a console action. The server's reason, as sent, stays on screen until the next try. */
export function useAct() {
  const { say } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, done?: string | ((r: T) => string)): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        if (done) say(typeof done === "function" ? done(r) : done);
        return r;
      } catch (e) {
        setError(e instanceof ApiError ? e.reason : e instanceof Error ? e.message : "Failed.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [say],
  );
  return { busy, error, run };
}

export function Reason({ message }: { message: string | null }) {
  return message ? <ErrorBox message={message} /> : null;
}

export function Field({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? (
        <div className="muted" style={{ fontSize: 13 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export const fmtTime = (ms: number | null): string =>
  ms === null
    ? "no expiry"
    : new Intl.DateTimeFormat("en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Toronto",
      }).format(new Date(ms));

export const fmtLeft = (secs: number): string => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
};

/** A short sentence for a change: what it does, to whom, where. Never content. */
export function describeChange(c: Change): string {
  const p = c.payload;
  const target = c.targetEmail ?? (typeof p.principalId === "string" ? whoIs(p.principalId) : "");
  const where = c.scopeKey.replace(/^[a-z]+:/, "");
  switch (c.kind) {
    case "role_upsert": {
      const r = p.role as { label?: string } | undefined;
      return `${p.create ? "Create" : "Edit"} role ${r?.label ?? where}`;
    }
    case "member_add":
      return `Add ${target} to ${where}`;
    case "member_remove":
      return `Remove ${target} from ${where}`;
    case "nda_grant":
      return `Named NDA grant for ${target} on ${String(p.accountId)} until ${fmtTime(Number(p.expiresAt))}`;
    default:
      return `Revoke ${target} on ${where}`;
  }
}
