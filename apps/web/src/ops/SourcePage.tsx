import { Cable, KeyRound, Minus, Plus, RotateCw, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../api";
import { useI18n } from "../i18n";
import { useUid } from "../insights/hooks";
import { useApi } from "../useApi";
import { AclStrip } from "./AclStrip";
import { ops } from "./api";
import { dayLabel, fmtWait, hm } from "./format";
import { LatencySwarm } from "./LatencySwarm";
import { RetryChart } from "./RetryChart";
import { defaultOf, parseTimes, retryPlan, samePolicy } from "./retry";
import { SourceStatusPill } from "./SourcesList";
import type { RetryPolicy, SourceConfig, SourcePatch } from "./types";
import { StateBox, SyntheticChip } from "./ui";

interface Draft {
  chips: string[];
  deltaMinutes: number;
  retry: RetryPolicy;
  timeoutSeconds: number;
  aclMaxAgeSeconds: number;
}

const fromConfig = (c: SourceConfig): Draft => ({
  chips: [...c.chips.selected],
  deltaMinutes: c.schedule.deltaMinutes,
  retry: c.retry,
  timeoutSeconds: c.timeoutSeconds,
  aclMaxAgeSeconds: c.aclMaxAgeSeconds,
});

/** What differs from the saved config, as the PUT body. Empty when nothing changed. */
export function patchOf(d: Draft, c: SourceConfig): SourcePatch {
  const p: SourcePatch = {};
  if (JSON.stringify(d.chips) !== JSON.stringify(c.chips.selected)) p.chips = d.chips;
  if (d.deltaMinutes !== c.schedule.deltaMinutes) p.schedule = { deltaMinutes: d.deltaMinutes };
  if (!samePolicy(d.retry, c.retry)) p.retry = d.retry;
  if (d.timeoutSeconds !== c.timeoutSeconds) p.timeoutSeconds = d.timeoutSeconds;
  if (d.aclMaxAgeSeconds !== c.aclMaxAgeSeconds) p.aclMaxAgeSeconds = d.aclMaxAgeSeconds;
  return p;
}

const DELTAS = [5, 15, 30, 60, 360, 1440];
const ACL_AGES = [60, 300, 900, 3600, 21_600, 86_400];
const KINDS: RetryPolicy["kind"][] = ["exponential", "linear", "fixed", "none"];
const CHIP_OK = /^[A-Za-z0-9/._ -]{1,60}$/;

function withCurrent(list: number[], v: number): number[] {
  return list.includes(v) ? list : [...list, v].sort((a, b) => a - b);
}

export function SourcePage() {
  const { id = "" } = useParams();
  const { t, td, lang } = useI18n();
  const uid = useUid();
  const cfg = useApi(() => ops.source(id), [id]);
  const [statsKey, setStatsKey] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: statsKey asks for a fresh read after a save
  const stats = useApi(() => ops.sourceStats(id), [id, statsKey]);
  const saved = cfg.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fixedText, setFixedText] = useState("");
  const [adding, setAdding] = useState(false);
  const [newChip, setNewChip] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "run" | "rotate" | "status" | null>(null);
  const [pending, setPending] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft starts from the saved config of this source only
  useEffect(() => {
    if (!saved) return;
    setDraft(fromConfig(saved));
    setFixedText(saved.retry.kind === "fixed" ? saved.retry.times.join(", ") : "");
    setPending(!!saved.credential.pending);
  }, [saved?.id]);

  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.reason : t("common.failed"));

  if (cfg.error && !saved)
    return (
      <section aria-labelledby={`${uid}-h`}>
        <h2 id={`${uid}-h`} className="sec-title">
          {t("v7o.src.title")}
        </h2>
        <StateBox
          kind="error"
          title={cfg.status === 403 ? t("v7o.err.forbidden") : t("v7o.err.load")}
          hint={cfg.error}
          action={
            <Link className="icard-btn" to="/settings/sources">
              {t("v7o.src.back")}
            </Link>
          }
        />
      </section>
    );
  if (!saved || !draft)
    return (
      <section aria-labelledby={`${uid}-h`}>
        <h2 id={`${uid}-h`} className="sec-title">
          {t("v7o.src.title")}
        </h2>
        <StateBox kind="loading" title={t("v7o.loading.source")} />
      </section>
    );

  const patch = patchOf(draft, saved);
  const dirty = Object.keys(patch).length > 0;
  const retryDirty = !samePolicy(draft.retry, saved.retry);
  const plan = retryPlan(draft.retry);
  const next =
    !retryDirty && stats.data?.retry.next && stats.data.retry.next.try <= plan.length + 1
      ? stats.data.retry.next
      : null;
  const paused = saved.status === "paused";
  const fixedBad = draft.retry.kind === "fixed" && parseTimes(fixedText) === null;

  const set = (p: Partial<Draft>) => {
    setMsg("");
    setErr(null);
    setDraft({ ...draft, ...p });
  };
  const pickKind = (kind: RetryPolicy["kind"]) => {
    const next = kind === draft.retry.kind ? draft.retry : defaultOf(kind);
    if (next.kind === "fixed") setFixedText(next.times.join(", "));
    set({ retry: next });
  };
  const addChip = (e: FormEvent) => {
    e.preventDefault();
    const v = newChip.trim();
    if (!v) return;
    if (!CHIP_OK.test(v) || draft.chips.length >= 40) {
      setErr(t("v7o.src.chip.bad"));
      return;
    }
    if (!draft.chips.includes(v)) set({ chips: [...draft.chips, v] });
    setNewChip("");
    setAdding(false);
  };
  const save = async () => {
    setBusy("save");
    setErr(null);
    try {
      const out = await ops.saveSource(id, patch);
      setDraft(fromConfig(out));
      cfg.reload();
      setStatsKey((k) => k + 1);
      setMsg(t("v7o.src.saved"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const discard = () => {
    setDraft(fromConfig(saved));
    setFixedText(saved.retry.kind === "fixed" ? saved.retry.times.join(", ") : "");
    setErr(null);
    setMsg(t("v7o.src.discarded"));
  };
  const toggle = async () => {
    setBusy("status");
    setErr(null);
    try {
      await ops.saveSource(id, { status: paused ? "active" : "paused" });
      cfg.reload();
      setMsg(paused ? t("v7o.src.resumed") : t("v7o.src.pausedmsg"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const run = async () => {
    setBusy("run");
    setErr(null);
    try {
      await ops.runSource(id);
      setMsg(t("v7o.src.run.started"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const rotate = async () => {
    setBusy("rotate");
    setErr(null);
    try {
      const r = await ops.rotate(id);
      if (r.status === "pending") {
        setPending(true);
        setMsg("");
      } else {
        setPending(false);
        setMsg(t("v7o.src.rotated"));
        cfg.reload();
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const kindLabel = (k: RetryPolicy["kind"]) =>
    `${td("v7o.retry.kind", k)}  ${td("v7o.retry.desc", k)}`;
  const rotatedOn = saved.credential.rotatedAt
    ? `${dayLabel(saved.credential.rotatedAt, lang)} ${hm(saved.credential.rotatedAt)}`
    : null;
  const t0 = stats.data?.latency;

  return (
    <section aria-labelledby={`${uid}-h`} className="opx-srcpage">
      <h2 id={`${uid}-h`} className="sr-only">
        {saved.name}
      </h2>
      <div className="opx-src-grid">
        <div className="icard opx opx-left" data-testid="source-charts">
          <div className="opx-left-b">
            <RetryChart plan={plan} next={next} none={draft.retry.kind === "none"} />
            {stats.error && !stats.data ? (
              <StateBox
                kind="error"
                title={t("v7o.err.load")}
                hint={stats.error}
                action={
                  <button type="button" className="icard-btn" onClick={stats.reload}>
                    {t("v7o.retry")}
                  </button>
                }
              />
            ) : !t0 ? (
              <StateBox kind="loading" title={t("v7o.loading.stats")} />
            ) : (
              <LatencySwarm
                latency={t0}
                timeoutSeconds={draft.timeoutSeconds}
                onRaise={(s) => {
                  set({ timeoutSeconds: s });
                  setMsg(t("v7o.lat.raised", { s }));
                }}
              />
            )}
          </div>
          <footer className="opx-left-f">
            <button
              type="button"
              className="icard-btn"
              onClick={discard}
              disabled={!dirty || busy !== null}
            >
              {t("v7o.src.discard")}
            </button>
            <button
              type="button"
              className="icard-btn solid"
              onClick={save}
              disabled={!dirty || busy !== null || fixedBad}
            >
              {busy === "save" ? t("common.working") : t("v7o.src.save")}
            </button>
          </footer>
        </div>

        <div className="icard opx opx-right" data-testid="source-form">
          <header className="icard-h">
            <span className="icard-ico" aria-hidden>
              <Cable size={20} />
            </span>
            <div className="icard-t">
              <h3>
                <Link className="crumb" to="/settings/sources">
                  {t("v7o.src.title")}
                </Link>
                <span className="slash" aria-hidden>
                  /
                </span>{" "}
                {saved.name}
              </h3>
              {saved.synthetic ? <SyntheticChip /> : null}
            </div>
            <div className="opx-ctl">
              <SourceStatusPill status={saved.status} />
              <button
                type="button"
                className="icard-btn sm"
                onClick={toggle}
                disabled={busy !== null}
              >
                {paused ? t("v7o.src.resume") : t("v7o.src.pause")}
              </button>
              <button
                type="button"
                className="icard-btn sm"
                onClick={run}
                disabled={paused || busy !== null}
              >
                {t("v7o.src.run")}
              </button>
            </div>
          </header>

          <div className="opx-form">
            <div className="opx-field">
              <span className="opx-lab">{t("v7o.src.f.source")}</span>
              <div className="opx-box">
                <span className="opx-tag">{td("v7o.src.provider", saved.provider)}</span>
                <code>{saved.location.folder}</code>
              </div>
            </div>
            <div className="opx-field">
              <span className="opx-lab">{t("v7o.src.f.target")}</span>
              <div className="opx-box">
                <Link
                  className="opx-link"
                  to={`/brains/${encodeURIComponent(saved.target.brainId)}`}
                >
                  {saved.target.label}
                </Link>
                <span className="mute">·</span>
                <span>{saved.target.collection}</span>
              </div>
            </div>

            <div className="opx-field">
              <div className="opx-lab-row">
                <span className="opx-lab" id={`${uid}-scope`}>
                  {t("v7o.src.f.scope")}
                </span>
                <span className="mono mute" data-testid="chip-count">
                  {t("v7o.src.chips.n", { n: draft.chips.length, total: saved.chips.total })}
                </span>
              </div>
              <ul className="opx-chips" aria-labelledby={`${uid}-scope`}>
                {draft.chips.map((c) => (
                  <li key={c} className="opx-xchip">
                    <code>{c}</code>
                    <button
                      type="button"
                      aria-label={t("v7o.src.chip.remove", { name: c })}
                      onClick={() => set({ chips: draft.chips.filter((x) => x !== c) })}
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </li>
                ))}
                <li>
                  {adding ? (
                    <form onSubmit={addChip} className="opx-addchip">
                      <input
                        // biome-ignore lint/a11y/noAutofocus: the field opens on the person's own click
                        autoFocus
                        list={`${uid}-avail`}
                        value={newChip}
                        maxLength={60}
                        aria-label={t("v7o.src.chip.add")}
                        placeholder={t("v7o.src.chip.ph")}
                        onChange={(e) => setNewChip(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            setAdding(false);
                            setNewChip("");
                          }
                        }}
                      />
                      <datalist id={`${uid}-avail`}>
                        {saved.chips.available
                          .filter((a) => !draft.chips.includes(a))
                          .map((a) => (
                            <option key={a} value={a} />
                          ))}
                      </datalist>
                      <button type="submit" className="icard-btn sm">
                        {t("v7o.src.chip.addbtn")}
                      </button>
                    </form>
                  ) : (
                    <button type="button" className="opx-addbtn" onClick={() => setAdding(true)}>
                      <Plus size={13} aria-hidden /> {t("v7o.src.chip.add")}
                    </button>
                  )}
                </li>
              </ul>
            </div>

            <div className="opx-field">
              <span className="opx-lab">{t("v7o.src.f.cred")}</span>
              <div className="opx-box cred">
                <KeyRound size={16} aria-hidden className="mute" />
                <code data-testid="secret-name">{saved.credential.name}</code>
                <span className="mute opx-small">
                  {rotatedOn
                    ? t("v7o.src.rotatedon", { when: rotatedOn })
                    : t("v7o.src.neverrotated")}
                </span>
                <button
                  type="button"
                  className="icard-btn sm"
                  onClick={rotate}
                  disabled={busy !== null}
                >
                  <RotateCw size={14} aria-hidden />{" "}
                  {pending ? t("v7o.src.rotate.confirm") : t("v7o.src.rotate")}
                </button>
              </div>
              {pending ? (
                <p className="opx-wait" role="status">
                  {t("v7o.src.rotate.wait")}
                </p>
              ) : null}
            </div>

            <div className="opx-row2">
              <div className="opx-field">
                <label className="opx-lab" htmlFor={`${uid}-delta`}>
                  {t("v7o.src.f.schedule")}
                </label>
                <select
                  id={`${uid}-delta`}
                  className="opx-select"
                  value={draft.deltaMinutes}
                  onChange={(e) => set({ deltaMinutes: Number(e.target.value) })}
                >
                  {withCurrent(DELTAS, draft.deltaMinutes).map((m) => (
                    <option key={m} value={m}>
                      {t("v7o.src.every", { s: fmtWait(m * 60) })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="opx-field">
                <label className="opx-lab" htmlFor={`${uid}-acl`}>
                  {t("v7o.src.f.acl")}
                </label>
                <select
                  id={`${uid}-acl`}
                  className="opx-select"
                  value={draft.aclMaxAgeSeconds}
                  onChange={(e) => set({ aclMaxAgeSeconds: Number(e.target.value) })}
                >
                  {withCurrent(ACL_AGES, draft.aclMaxAgeSeconds).map((s) => (
                    <option key={s} value={s}>
                      {fmtWait(s)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="opx-row2">
              <div className="opx-field">
                <label className="opx-lab" htmlFor={`${uid}-retry`}>
                  {t("v7o.src.f.retry")}
                </label>
                <select
                  id={`${uid}-retry`}
                  className="opx-select"
                  value={draft.retry.kind}
                  onChange={(e) => pickKind(e.target.value as RetryPolicy["kind"])}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="opx-field">
                <span className="opx-lab" id={`${uid}-to`}>
                  {t("v7o.src.f.timeout")}
                </span>
                <div className="opx-step" role="group" aria-labelledby={`${uid}-to`}>
                  <button
                    type="button"
                    aria-label={t("v7o.src.timeout.dec")}
                    onClick={() => set({ timeoutSeconds: Math.max(5, draft.timeoutSeconds - 5) })}
                    disabled={draft.timeoutSeconds <= 5}
                  >
                    <Minus size={16} aria-hidden />
                  </button>
                  <output className="mono" data-testid="timeout-value">
                    {draft.timeoutSeconds} s
                  </output>
                  <button
                    type="button"
                    aria-label={t("v7o.src.timeout.inc")}
                    onClick={() => set({ timeoutSeconds: Math.min(120, draft.timeoutSeconds + 5) })}
                    disabled={draft.timeoutSeconds >= 120}
                  >
                    <Plus size={16} aria-hidden />
                  </button>
                </div>
              </div>
            </div>
            {draft.retry.kind === "fixed" ? (
              <div className="opx-field">
                <label className="opx-lab" htmlFor={`${uid}-fixed`}>
                  {t("v7o.src.fixed.l")}
                </label>
                <input
                  id={`${uid}-fixed`}
                  className="opx-input mono"
                  value={fixedText}
                  aria-invalid={fixedBad}
                  aria-describedby={fixedBad ? `${uid}-fixed-e` : undefined}
                  onChange={(e) => {
                    setFixedText(e.target.value);
                    const times = parseTimes(e.target.value);
                    if (times) set({ retry: { kind: "fixed", times } });
                  }}
                />
                {fixedBad ? (
                  <p id={`${uid}-fixed-e`} className="opx-err">
                    {t("v7o.src.fixed.bad")}
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="opx-note">{t("v7o.retry.honours")}</p>
            {saved.lastError ? (
              <p className="opx-note bad">{t("v7o.src.lasterror", { why: saved.lastError })}</p>
            ) : null}
            <p className="opx-ok" role="status">
              {msg}
            </p>
            {err ? (
              <p className="opx-err" role="alert">
                {err}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      {stats.data ? (
        <div className="icard opx opx-acl-card">
          <AclStrip acl={stats.data.acl} />
        </div>
      ) : null}
    </section>
  );
}
