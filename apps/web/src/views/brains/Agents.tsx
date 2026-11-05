import { Check, Copy, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api";
import { Await, fmtDate, PageHead } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { v3 } from "./api";
import "./brains.css";
import type { AgentHost, HostId } from "./types";

export const HOST_TABS: HostId[] = [
  "claude_code",
  "claude_ai",
  "chatgpt",
  "codex",
  "dust",
  "copilot_studio",
];

/** Where the MCP door is. Set VITE_MCP_URL when it lives on another host than the API. */
export function mcpUrl(): string {
  const env = (import.meta.env.VITE_MCP_URL as string | undefined) ?? "";
  if (env) return env;
  const { hostname, origin } = window.location;
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? "http://localhost:8788/mcp"
    : `${origin}/mcp`;
}

export function handleOf(email: string | undefined): string {
  const h = (email ?? "me")
    .split("@")[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return h || "me";
}

/** The exact command for hosts that have one. Dynamic client registration means no client id to paste. */
export function commandFor(host: HostId, handle: string, url: string): string | null {
  const name = `secondary-${handle}`;
  if (host === "claude_code")
    return `claude mcp add --transport http --callback-port 3118 ${name} ${url}`;
  if (host === "codex") return `codex mcp add ${name} --url ${url} && codex mcp login ${name}`;
  return null;
}

export const SNIPPET = `Use the Secondary connector for company knowledge.
1. Call get_brain_guide for the brain you work in before you write anything.
2. Search before you answer, and cite the pages you used.
3. Say "unknown" when no page answers. Do not guess.
4. Send new knowledge as a proposal for review. Never publish directly.
5. Never send personal conversations or client contact details.`;

function CopyBox({ label, text }: { label: string; text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked: the text stays selectable on the page */
    }
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 2500);
  };
  return (
    <div className="copybox">
      <div className="row between">
        <span className="copy-l" id={`cb-${label}`}>
          {label}
        </span>
        <button type="button" className="btn sm" onClick={copy} aria-describedby={`cb-${label}`}>
          {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{" "}
          {done ? t("b3.ag.copied") : t("b3.ag.copy")}
        </button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
      <span className="sr-only" role="status">
        {done ? t("b3.ag.copied") : ""}
      </span>
    </div>
  );
}

function Connection({
  c,
  onRevoke,
}: {
  c: AgentHost["connections"][number];
  onRevoke: (id: string) => Promise<void>;
}) {
  const { t, td } = useI18n();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ask) yes.current?.focus();
  }, [ask]);
  return (
    <li className="conn">
      <div className="conn-main">
        <p>
          <span className={`chip t-${c.state === "active" ? "done" : "risk"}`}>
            {td("b3.ag.state", c.state, c.state)}
          </span>{" "}
          <span className="muted">
            {c.lastCallAt
              ? t("b3.ag.lastcall", { when: fmtDate(c.lastCallAt) })
              : t("b3.ag.nocall")}
            {c.lastTool ? ` · ${c.lastTool}` : ""}
          </span>
        </p>
        <p className="scopes">
          {c.scopes.map((s) => (
            <span key={s} className="chip t-open mono">
              {s}
            </span>
          ))}
        </p>
      </div>
      {c.state === "active" ? (
        ask ? (
          <div className="confirm" role="group" aria-label={t("b3.ag.confirm.title")}>
            <p>
              <b>{t("b3.ag.confirm.title")}</b> {t("b3.ag.confirm.lead")}
            </p>
            <div className="row">
              <button
                ref={yes}
                type="button"
                className="btn sm danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onRevoke(c.id);
                  setBusy(false);
                  setAsk(false);
                }}
              >
                {busy ? t("common.working") : t("b3.ag.confirm.yes")}
              </button>
              <button type="button" className="btn sm ghost" onClick={() => setAsk(false)}>
                {t("b3.ag.confirm.no")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn sm danger" onClick={() => setAsk(true)}>
            <Unplug size={14} aria-hidden /> {t("b3.ag.revoke")}
          </button>
        )
      ) : null}
    </li>
  );
}

export function HostPanel({
  host,
  handle,
  onChange,
}: {
  host: AgentHost;
  handle: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const { say } = useApp();
  const url = mcpUrl();
  const cmd = commandFor(host.id, handle, url);
  const steps = [1, 2, 3].map((n) => `b3.ag.steps.${host.id}.${n}` as Key);
  const revoke = async (id: string) => {
    try {
      const r = await v3.revokeConnection(id);
      say(t("b3.ag.revoked", { n: r.revoked }));
      onChange();
    } catch (e) {
      say(e instanceof ApiError ? e.reason : t("common.failed"));
    }
  };
  return (
    <div
      className="host-panel"
      role="tabpanel"
      id={`ag-panel-${host.id}`}
      aria-labelledby={`ag-tab-${host.id}`}
    >
      <section className="card status" aria-labelledby={`st-${host.id}`}>
        <h3 id={`st-${host.id}`}>{t("b3.ag.status")}</h3>
        <p>
          <span className={`chip t-${host.connected ? "done" : "open"}`} data-testid="host-state">
            {host.connected ? t("b3.ag.connected") : t("b3.ag.notconnected")}
          </span>{" "}
          <span className="muted">
            {host.lastCallAt
              ? t("b3.ag.lastcall", { when: fmtDate(host.lastCallAt) })
              : t("b3.ag.nocall")}
            {host.calls ? ` · ${t("b3.ag.calls", { n: host.calls })}` : ""}
          </span>
        </p>
        {host.connections.length ? (
          <ul className="conns">
            {host.connections.map((c) => (
              <Connection key={c.id} c={c} onRevoke={revoke} />
            ))}
          </ul>
        ) : (
          <p className="muted">{t("b3.ag.noconn")}</p>
        )}
      </section>
      <section className="card" aria-labelledby={`cn-${host.id}`}>
        <h3 id={`cn-${host.id}`}>{t("b3.ag.connect")}</h3>
        {cmd ? (
          <CopyBox label={t("b3.ag.command")} text={cmd} />
        ) : (
          <CopyBox label={t("b3.ag.url")} text={url} />
        )}
        <ol className="agsteps">
          {steps.map((k) => (
            <li key={k}>{t(k, { name: host.label, url })}</li>
          ))}
        </ol>
        <p className="muted">{t("b3.ag.dcr")}</p>
      </section>
      <section className="card" aria-labelledby={`sn-${host.id}`}>
        <h3 id={`sn-${host.id}`}>{t("b3.ag.snippet")}</h3>
        <p className="muted">{t("b3.ag.snippet.lead")}</p>
        <CopyBox label={t("b3.ag.snippet.l")} text={SNIPPET} />
      </section>
    </div>
  );
}

export function AgentsPage() {
  const { t } = useI18n();
  const { me } = useApp();
  const list = useApi(() => v3.agents(), []);
  const [tab, setTab] = useState<HostId>("claude_code");
  const handle = handleOf(me?.principal.email);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = HOST_TABS[(i + d + HOST_TABS.length) % HOST_TABS.length] as HostId;
    setTab(next);
    document.getElementById(`ag-tab-${next}`)?.focus();
  };
  return (
    <div className="page brains agents">
      <PageHead eyebrow={t("nav.agents")} title={t("b3.ag.title")} lead={t("b3.ag.lead")} />
      <Await state={list} skeleton={3}>
        {({ hosts }) => {
          const byId = new Map(hosts.map((h) => [h.id, h]));
          const cur = byId.get(tab) ?? {
            id: tab,
            label: tab,
            connected: false,
            lastCallAt: null,
            calls: 0,
            scopes: [],
            connections: [],
          };
          return (
            <>
              <div className="tabs" role="tablist" aria-label={t("b3.ag.hosts")}>
                {HOST_TABS.map((h, i) => {
                  const x = byId.get(h);
                  return (
                    <button
                      key={h}
                      id={`ag-tab-${h}`}
                      type="button"
                      className="tab"
                      role="tab"
                      aria-selected={tab === h}
                      aria-controls={`ag-panel-${h}`}
                      tabIndex={tab === h ? 0 : -1}
                      onClick={() => setTab(h)}
                      onKeyDown={(e) => onKey(e, i)}
                    >
                      <i className={`dot-s ${x?.connected ? "on" : ""}`} aria-hidden />
                      {x?.label ?? h}
                      {x?.connected ? (
                        <span className="sr-only"> ({t("b3.ag.connected")})</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <HostPanel host={cur} handle={handle} onChange={list.reload} />
            </>
          );
        }}
      </Await>
    </div>
  );
}
