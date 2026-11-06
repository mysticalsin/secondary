import { FLOOR_IDS } from "@secondary/policy";
import { ChevronDown, Lock, Pencil, Plus, Shield, Siren } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api";
import { Await, Empty } from "../components/ui";
import { type Key, useI18n } from "../i18n";
import { useApp } from "../state";
import { useApi } from "../useApi";
import { v3 } from "../views/brains/api";
import { rulesApi } from "./api";
import { RuleEditor } from "./Editor";
import { shortDate, useRuleText } from "./text";
import type { BrainChoice, HoldRow, IncidentState, RuleRow, RulesList } from "./types";

/** Brains a rule may name: the ones the viewer may reach, minus Personal Brains. Stewards: their own. */
function useBrainChoices(enabled: boolean, admin: boolean): BrainChoice[] {
  const [list, setList] = useState<BrainChoice[]>([]);
  const { epoch } = useApp();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    v3.directory().then(
      (r) => {
        if (!live) return;
        setList(
          r.brains
            .filter((b) => b.type !== "personal")
            .filter((b) => admin || ("manages" in b && b.manages))
            .map((b) => ({ id: b.id, label: b.name, type: b.type })),
        );
      },
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, [enabled, admin, epoch]);
  return list;
}

function StatusChip({ status }: { status: RuleRow["status"] }) {
  const { t } = useI18n();
  return <span className={`rl-st ${status}`}>{t(`v7.st.${status}` as Key)}</span>;
}

function FloorRow() {
  const { t } = useI18n();
  return (
    <li className="rl-li rl-row floor" data-testid="rule-floor">
      <span className="rl-ico" aria-hidden>
        <Lock size={18} />
      </span>
      <span className="rl-main">
        <b>{t("v7.floor.row")}</b>
      </span>
      <span className="rl-st floorchip">{t("v7.floor.always")}</span>
    </li>
  );
}

function RowView({ row, open, onOpen }: { row: RuleRow; open: boolean; onOpen: () => void }) {
  const { t } = useI18n();
  const text = useRuleText();
  const body = (
    <>
      <span className="rl-ico" aria-hidden>
        <Shield size={18} />
      </span>
      <span className="rl-main">
        <b>{row.name}</b>
        <span className="rl-sub">
          {text.scopeText(row.scope, row.scopeLabel)} · {text.effectShort(row.effect)}
        </span>
      </span>
      <span className="rl-meta">
        {row.hasDraft ? (
          <span className="rl-draftmark" title={t("v7.row.unpublished")}>
            <Pencil size={12} aria-hidden /> {t("v7.row.unpublished")}
          </span>
        ) : null}
        <StatusChip status={row.status} />
        <span className="rl-ver-tag mono">
          {row.version > 0 ? t("v7.version", { n: row.version }) : t("v7.row.notpublished")}
        </span>
      </span>
    </>
  );
  if (!row.editable)
    return (
      <li className="rl-li rl-row ro" data-testid="rule-row-ro" title={t("v7.row.readonly.why")}>
        {body}
        <span className="rl-ro-tag">
          <Lock size={12} aria-hidden /> {t("v7.row.readonly")}
        </span>
      </li>
    );
  return (
    <li className="rl-li">
      <button
        type="button"
        className={`rl-row${open ? " sel" : ""}`}
        aria-current={open ? "true" : undefined}
        data-testid="rule-row"
        onClick={onOpen}
      >
        {body}
      </button>
    </li>
  );
}

function Incident({
  state,
  admin,
  onChanged,
}: {
  state: IncidentState;
  admin: boolean;
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const { say } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const wantOn = !state.on;
  const go = async (on: boolean) => {
    setBusy(true);
    try {
      const r = await rulesApi.setIncident(on, on && reason.trim() ? reason.trim() : undefined);
      say(r?.pending ? t("v7.inc.say.pending") : t(on ? "v7.inc.say.on" : "v7.inc.say.off"));
      setReason("");
      onChanged();
    } catch (e) {
      say(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  const until = state.until
    ? new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(state.until))
    : "";
  const label = state.on
    ? t("v7.inc.on", { until })
    : state.pending
      ? state.by === "other"
        ? t("v7.inc.pending.other")
        : t("v7.inc.pending.you")
      : t("v7.inc.off");
  const button = state.on
    ? t("v7.inc.turnoff")
    : state.pending && state.by === "other"
      ? t("v7.inc.confirm")
      : t("v7.inc.turnon");
  const waitingOnOther = !state.on && state.pending && state.by === "you";
  return (
    <section className="rl-card" aria-labelledby="rl-inc-h" data-testid="rule-incident">
      <div className="rl-card-head">
        <h3 id="rl-inc-h" className="rl-h3">
          <Siren size={16} aria-hidden /> {t("v7.inc.title")}
        </h3>
        <span
          className={`rl-st inc ${state.on ? "on" : state.pending ? "wait" : "off"}`}
          data-testid="incident-state"
        >
          {label}
        </span>
      </div>
      <p className="muted">{t("v7.inc.lead")}</p>
      {admin ? (
        <div className="rl-inc-actions">
          {wantOn && !state.pending ? (
            <>
              <label className="sr-only" htmlFor="rl-inc-reason">
                {t("v7.inc.reason")}
              </label>
              <input
                id="rl-inc-reason"
                className="input"
                value={reason}
                placeholder={t("v7.inc.reason")}
                onChange={(e) => setReason(e.target.value)}
              />
            </>
          ) : null}
          <button
            type="button"
            className={`btn${state.on ? "" : " primary"}`}
            disabled={busy || waitingOnOther}
            onClick={() => go(!state.on)}
            data-testid="incident-toggle"
          >
            {button}
          </button>
        </div>
      ) : (
        <p className="rl-fine">{t("v7.inc.admins")}</p>
      )}
    </section>
  );
}

function Holds({ holds, onChanged }: { holds: HoldRow[]; onChanged: () => void }) {
  const { t } = useI18n();
  const text = useRuleText();
  const { say } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const groupLabel = (g: string) =>
    g === "stewards" || g === "privacy" ? t(`v7.val.group.${g}` as Key) : g;
  const decide = async (h: HoldRow, decision: "approve" | "reject") => {
    setBusy(h.id);
    try {
      const r = await rulesApi.decideHold(h.id, decision);
      say(t(`v7.holds.say.${r.status}` as Key));
      onChanged();
    } catch (e) {
      say(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="rl-card" aria-labelledby="rl-holds-h" data-testid="rule-holds">
      <h3 id="rl-holds-h" className="rl-h3">
        {t("v7.holds.title")} <span className="cnt">{holds.length}</span>
      </h3>
      <p className="muted">{t("v7.holds.lead")}</p>
      {holds.length === 0 ? (
        <p className="muted">{t("v7.holds.none")}</p>
      ) : (
        <ul className="rl-holds">
          {holds.map((h) => {
            const action = text.valueLabel("action", h.action);
            const brain = h.brain.label || t("v7.actor.restricted");
            return (
              <li key={h.id} className="rl-hold" data-testid="rule-hold">
                <div>
                  <b>{t("v7.holds.line", { action, brain })}</b>
                  <p className="muted rl-hold-meta">
                    {t("v7.holds.meta", {
                      rule: h.rule,
                      when: text.ago(h.requestedAt),
                      approvals: h.approvals,
                      required: h.required,
                    })}
                    {h.group.length
                      ? ` · ${t("v7.holds.group", { group: h.group.map(groupLabel).join(", ") })}`
                      : ""}
                  </p>
                  {h.mine ? <p className="rl-fine">{t("v7.holds.mine")}</p> : null}
                </div>
                {h.canDecide ? (
                  <div className="rl-hold-actions">
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={busy === h.id}
                      aria-label={t("v7.holds.approve.one", { action, brain })}
                      onClick={() => decide(h, "approve")}
                    >
                      {t("v7.holds.approve")}
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy === h.id}
                      aria-label={t("v7.holds.reject.one", { action, brain })}
                      onClick={() => decide(h, "reject")}
                    >
                      {t("v7.holds.reject")}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Floors() {
  const { t } = useI18n();
  return (
    <details className="rl-floors" data-testid="rule-floors">
      <summary>
        <span className="rl-sum">
          <Lock size={15} aria-hidden /> {t("v7.floors.title")}{" "}
          <span className="cnt">{FLOOR_IDS.length}</span>
        </span>
        <ChevronDown size={16} className="rl-fl-chev" aria-hidden />
      </summary>
      <p className="muted">{t("v7.floors.lead")}</p>
      <ul>
        {FLOOR_IDS.map((id) => (
          <li key={id}>{t(`v7.floor.${id}` as Key)}</li>
        ))}
      </ul>
    </details>
  );
}

function Body({ data, brain, reload }: { data: RulesList; brain?: string; reload: () => void }) {
  const { t, lang } = useI18n();
  const { me } = useApp();
  const admin = !!me?.capabilities?.configure;
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const choices = useBrainChoices(open !== undefined, admin);
  const c = data.counts;
  const close = useCallback(() => setOpen(undefined), []);
  const label = data.brain?.label ?? brain ?? "";
  return (
    <>
      <p className="muted rl-lead">
        {data.brain ? t("v7.rules.lead.brain", { brain: label }) : t("v7.rules.lead")}
      </p>
      <div className="rl-stats" data-testid="rule-counts">
        <div className="rl-big">
          <span className="rl-count">{c.total}</span>
          <span className={`rl-delta${c.new > 0 ? "" : " none"}`}>
            {c.new > 0 ? <i className="rl-tri" aria-hidden /> : null}
            {c.new > 0
              ? t("v7.count.since", { n: c.new, date: shortDate(c.since, lang) })
              : t("v7.count.none", { date: shortDate(c.since, lang) })}
          </span>
        </div>
        <div className="rl-tally">
          <span>{t("v7.count.enforced", { n: c.enforced })}</span>
          <span>{t("v7.count.rest", { m: c.monitor, d: c.draft })}</span>
        </div>
      </div>

      <div className="rl-listhead">
        <h3 className="rl-h3">
          {t("v7.list.label")} <span className="cnt">{c.total}</span>
        </h3>
        {data.canEdit ? (
          <button
            type="button"
            className="btn primary"
            data-testid="rule-new"
            onClick={() => setOpen(null)}
          >
            <Plus size={16} aria-hidden /> {t("v7.new")}
          </button>
        ) : null}
      </div>
      <ul className="rl-list" aria-label={t("v7.list.label")} data-testid="rule-list">
        {data.rules.map((r) =>
          r.readOnly || r.floor ? (
            <FloorRow key={r.id} />
          ) : (
            <RowView key={r.id} row={r} open={open === r.id} onOpen={() => setOpen(r.id)} />
          ),
        )}
      </ul>

      <Floors />
      <Incident state={data.incident} admin={admin} onChanged={reload} />
      <Holds holds={data.holds} onChanged={reload} />

      {open !== undefined ? (
        <RuleEditor
          ruleId={open}
          brains={choices}
          admin={admin}
          brain={data.brain?.id ?? null}
          onClose={close}
          onChanged={reload}
        />
      ) : null}
    </>
  );
}

/** The Rules list. `brain` limits it to the rules that reach one brain (the steward's view). */
export default function RulesPage({ brain }: { brain?: string }) {
  const { t } = useI18n();
  const state = useApi(() => rulesApi.list(brain), [brain]);
  // Keep the list on screen while it reloads after a save, so the editor beside it does not flicker.
  const [last, setLast] = useState<RulesList | null>(null);
  useEffect(() => {
    if (state.data) setLast(state.data);
  }, [state.data]);
  const data = state.data ?? last;
  if (state.status === 404) return <Empty title={t("v7.err.none")} />;
  return (
    <section aria-labelledby="rl-h" className="rl" data-testid="rules-page">
      <h2 id="rl-h" className="sec-title rl-title">
        <Shield size={20} aria-hidden /> {t("v7.rules")}
      </h2>
      {data ? (
        <Body data={data} brain={brain} reload={state.reload} />
      ) : (
        <Await state={state} skeleton={3}>
          {() => null}
        </Await>
      )}
    </section>
  );
}
