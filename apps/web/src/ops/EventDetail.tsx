import { Check, Copy, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import { useI18n } from "../i18n";
import { useApi } from "../useApi";
import { hms } from "./format";
import type { EventDetail, EventStep, OpEvent, RetryResult } from "./types";
import { StateBox } from "./ui";

function StepIcon({ state }: { state: EventStep["state"] }) {
  if (state === "fail")
    return (
      <span className="opx-si fail" aria-hidden>
        <X size={11} strokeWidth={3} />
      </span>
    );
  if (state === "ok")
    return (
      <span className="opx-si ok" aria-hidden>
        <Check size={11} strokeWidth={3} />
      </span>
    );
  return <span className={`opx-si ${state}`} aria-hidden />;
}

function Steps({ steps }: { steps: EventStep[] }) {
  const { t, td } = useI18n();
  return (
    <ol className="opx-steps">
      {steps.map((s, i) => {
        const parts: string[] = [];
        if (s.code) parts.push(s.label);
        if (s.state === "pending" || s.state === "skipped") parts.push(td("v7o.step", s.state));
        if (s.at) parts.push(hms(s.at));
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: steps have no id and never reorder
          <li key={i} className={`st-${s.state}`}>
            <StepIcon state={s.state} />
            <div>
              <b className="mono">{s.code ?? s.label}</b>
              <span>{parts.join(" · ")}</span>
              <span className="sr-only"> ({t(`v7o.step.${s.state}` as "v7o.step.ok")})</span>
            </div>
            <span className="opx-ms mono">{s.ms === null ? "" : `${s.ms} ms`}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Metadata as a JSON listing with line numbers. It prints exactly the keys the API sent: ids and codes. */
export function JsonView({ data, label }: { data: Record<string, string>; label: string }) {
  const keys = Object.keys(data);
  const lines: { k?: string; v?: string; text?: string }[] = [{ text: "{" }];
  keys.forEach((k, i) => {
    lines.push({ k, v: data[k] as string, text: i < keys.length - 1 ? "," : "" });
  });
  lines.push({ text: "}" });
  return (
    <div className="opx-json" role="group" aria-label={label}>
      {lines.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
        <div key={i} className="ln">
          <span className="no" aria-hidden>
            {i + 1}
          </span>
          {l.k !== undefined ? (
            <code>
              {"  "}
              <span className="k">"{l.k}"</span>: <span className="s">"{l.v}"</span>
              {l.text}
            </code>
          ) : (
            <code>{l.text}</code>
          )}
        </div>
      ))}
    </div>
  );
}

type Retried = "queued" | "already" | null;

/** Steps, metadata and the two actions of one event. Retry is offered only when the API says so. */
export function EventDetailPanel({
  event,
  load,
  retry,
}: {
  event: OpEvent;
  load: (id: string) => Promise<EventDetail>;
  retry?: ((id: string) => Promise<RetryResult>) | undefined;
}) {
  const { t } = useI18n();
  const d = useApi(() => load(event.id), [event.id]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retried, setRetried] = useState<Retried>(null);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another event opens
  useEffect(() => {
    setRetried(null);
    setErr(null);
    setCopied(false);
  }, [event.id]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(event.id);
    } catch {
      /* clipboard blocked: the id stays selectable in the table */
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2500);
  };
  const doRetry = async () => {
    if (!retry) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await retry(event.id);
      setRetried(r.already ? "already" : "queued");
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  const detail = d.data;
  const canRetry = !!retry && (detail?.retryable ?? event.retryable);
  const state: Retried = retried ?? (detail?.retry ? "already" : null);
  return (
    <section
      id="opx-detail"
      className="opx-detail"
      aria-label={t("v7o.detail.label", { id: event.id })}
    >
      {d.error ? (
        <StateBox
          kind="error"
          title={t("v7o.detail.error")}
          hint={d.error}
          action={
            <button type="button" className="icard-btn" onClick={d.reload}>
              {t("v7o.retry")}
            </button>
          }
        />
      ) : !detail ? (
        <StateBox kind="loading" title={t("v7o.detail.loading")} />
      ) : (
        <>
          <div className="opx-dcol">
            <h4>{t("v7o.detail.steps")}</h4>
            <Steps steps={detail.steps} />
          </div>
          <div className="opx-dcol">
            <h4>{t("v7o.detail.meta")}</h4>
            <JsonView data={detail.metadata} label={t("v7o.detail.meta")} />
            <p className="opx-note">{t("v7o.detail.note")}</p>
            <div className="opx-actions">
              <button type="button" className="icard-btn" onClick={copy}>
                {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}{" "}
                {copied ? t("v7o.detail.copied") : t("v7o.detail.copy")}
              </button>
              {canRetry ? (
                <button
                  type="button"
                  className="icard-btn solid"
                  disabled={busy || state !== null}
                  onClick={doRetry}
                >
                  <RotateCw size={16} aria-hidden />{" "}
                  {state === "queued"
                    ? t("v7o.retry.queued")
                    : state === "already"
                      ? t("v7o.retry.already")
                      : t("v7o.retry.ingest")}
                </button>
              ) : null}
            </div>
            <span className="sr-only" role="status">
              {copied
                ? t("v7o.detail.copied")
                : state === "queued"
                  ? t("v7o.retry.queued")
                  : state === "already"
                    ? t("v7o.retry.already")
                    : ""}
            </span>
            {err ? (
              <p className="opx-err" role="alert">
                {err}
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
