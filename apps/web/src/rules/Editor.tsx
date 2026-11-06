import { FIELD_SPEC, RULE_EFFECTS, RULE_FIELDS, type RuleField } from "@secondary/policy";
import {
  BadgeCheck,
  Ban,
  Bell,
  ChevronDown,
  CircleAlert,
  FlaskConical,
  History as HistoryIcon,
  Hourglass,
  Lock,
  Plus,
  Shield,
  Timer,
  UserCheck,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ApiError } from "../api";
import { Skeleton } from "../components/ui";
import { type Key, useI18n } from "../i18n";
import { useFocusTrap } from "../lib/focus";
import { useApp } from "../state";
import { useApi } from "../useApi";
import { issuesOf, rulesApi } from "./api";
import { type ChipOption, ChipsInput } from "./Chips";
import { History } from "./History";
import { Impact, type SimState } from "./Impact";
import { useRuleText } from "./text";
import type {
  BrainChoice,
  Condition,
  PublishResult,
  RuleDetail,
  RuleDraft,
  RuleEffect,
  RuleScope,
  RuleStatus,
  ValidationIssue,
} from "./types";

const EFFECT_ICON: Record<RuleEffect, typeof UserCheck> = {
  review: UserCheck,
  two_approvers: Users,
  group: UsersRound,
  block: Ban,
  notify: Bell,
  expire: Timer,
};
// `then` is the policy model's own word for the effect. Written as a computed key, so a rule is never
// mistaken for a thenable by the linter.
const THEN = "then" as const;
const withThen = (d: RuleDraft, t: RuleDraft["then"]): RuleDraft => ({ ...d, [THEN]: t });
const STATUSES: RuleStatus[] = ["draft", "monitor", "enforced"];
const GROUPS = ["stewards", "privacy"] as const;

export const blankCondition = (): Condition => ({ field: "action", op: "is_any_of", values: [] });

export function blankDraft(
  brains: BrainChoice[],
  admin: boolean,
  brain?: string | null,
): RuleDraft {
  const first = brain ?? brains[0]?.id;
  return withThen(
    {
      name: "",
      scope: brain || !admin ? { kind: "brains", ids: first ? [first] : [] } : { kind: "tenant" },
      when: [blankCondition()],
      except: { incident: false },
      status: "draft",
    } as RuleDraft,
    { effect: "review" },
  );
}

/** The `then` part a new effect needs and nothing else, so a stale message never rides along. */
function thenFor(effect: RuleEffect, old: RuleDraft["then"]): RuleDraft["then"] {
  if (effect === "group")
    return { effect, approvers: old.approvers?.length ? old.approvers : ["stewards"] };
  if (effect === "expire") return { effect, expiresAfterMin: old.expiresAfterMin ?? 15 };
  if (effect === "block") return { effect, message: old.message ?? "" };
  return { effect };
}

function Issue({ id, items }: { id: string; items: ValidationIssue[] }) {
  const { t, td } = useI18n();
  if (!items.length) return null;
  return (
    <div id={id} className="rl-issues" data-testid="rule-issue">
      {items.map((i) => (
        <p
          key={`${i.path}-${i.code}-${i.message}`}
          className={`rl-issue${i.floor ? " floor" : ""}`}
          role="alert"
        >
          {i.floor ? <Lock size={14} aria-hidden /> : <CircleAlert size={14} aria-hidden />}
          <span>
            {i.floor ? <span className="rl-floorchip">{t("v7.floor.chip")}</span> : null}{" "}
            {i.floor ? t(`v7.floor.${i.floor}` as Key) : td("v7.issue", i.code, i.message)}
          </span>
        </p>
      ))}
    </div>
  );
}

function SelectBox({
  id,
  label,
  value,
  onChange,
  children,
  icon,
  invalid,
  describedBy,
  disabled,
  className,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  icon?: ReactNode;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`rl-selwrap${icon ? " withicon" : ""}${className ? ` ${className}` : ""}`}>
      {icon ? <span className="rl-lead-ico">{icon}</span> : null}
      <select
        id={id}
        className="rl-select"
        aria-label={id ? undefined : label}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      <ChevronDown size={14} className="rl-chev" aria-hidden />
    </div>
  );
}

function ConditionRow({
  n,
  c,
  canRemove,
  brains,
  issues,
  onChange,
  onRemove,
}: {
  n: number;
  c: Condition;
  canRemove: boolean;
  brains: BrainChoice[];
  issues: ValidationIssue[];
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const text = useRuleText();
  const uid = useId();
  const spec = FIELD_SPEC[c.field];
  const names = useMemo(() => Object.fromEntries(brains.map((b) => [b.id, b.label])), [brains]);
  const options = useMemo<ChipOption[]>(() => {
    if (spec.values === "number") return [];
    if (spec.values === "brain_ids") return brains.map((b) => ({ id: b.id, label: b.label }));
    return spec.values
      .filter((v) => !(c.field === "brain_type" && v === "personal"))
      .map((v) => ({ id: v, label: text.valueLabel(c.field, v, names) }));
  }, [spec, c.field, brains, names, text]);
  const issueId = `${uid}-issue`;
  const bad = issues.length > 0;
  return (
    <div className="rl-cond" data-testid="rule-condition">
      <div className="rl-cond-row">
        <SelectBox
          label={t("v7.ed.field", { n })}
          value={c.field}
          invalid={bad}
          describedBy={bad ? issueId : undefined}
          onChange={(f) => {
            const field = f as RuleField;
            const op = FIELD_SPEC[field].ops[0] ?? "is_any_of";
            onChange({ field, op, values: [] });
          }}
        >
          {RULE_FIELDS.map((f) => (
            <option key={f} value={f}>
              {text.fieldLabel(f)}
            </option>
          ))}
        </SelectBox>
        <SelectBox
          label={t("v7.ed.op", { n })}
          value={c.op}
          invalid={bad}
          describedBy={bad ? issueId : undefined}
          disabled={spec.ops.length < 2}
          onChange={(op) => onChange({ ...c, op: op as Condition["op"] })}
        >
          {spec.ops.map((o) => (
            <option key={o} value={o}>
              {text.opLabel(o)}
            </option>
          ))}
        </SelectBox>
        <div className="rl-cond-val">
          {spec.values === "number" ? (
            <input
              className="rl-input"
              type="number"
              min={0}
              inputMode="numeric"
              aria-label={t("v7.ed.values", { n })}
              aria-invalid={bad || undefined}
              aria-describedby={bad ? issueId : undefined}
              value={c.values[0] ?? ""}
              placeholder={t("v7.ed.pages")}
              onChange={(e) =>
                onChange({ ...c, values: e.target.value === "" ? [] : [e.target.value] })
              }
            />
          ) : (
            <ChipsInput
              label={t("v7.ed.values", { n })}
              values={c.values}
              options={options}
              invalid={bad}
              describedBy={bad ? issueId : undefined}
              onChange={(values) => onChange({ ...c, values })}
            />
          )}
        </div>
        <button
          type="button"
          className="rl-x"
          aria-label={t("v7.ed.remove", { n })}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <Issue id={issueId} items={issues} />
    </div>
  );
}

function Banner({
  detail,
  busy,
  onConfirm,
}: {
  detail: RuleDetail;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const p = detail.pending;
  if (!p) return null;
  const rollback = p.kind === "rollback";
  const title = p.by === "you" ? t("v7.ed.waiting") : t("v7.ed.other");
  const lead =
    p.by === "you"
      ? rollback
        ? t("v7.ed.waiting.rollback", { n: p.version })
        : t("v7.ed.waiting.lead", { n: p.version })
      : rollback
        ? t("v7.ed.other.rollback", { n: p.version })
        : t("v7.ed.other.lead", { n: p.version });
  return (
    <div className="rl-banner" role="status" data-testid="rule-pending">
      <Hourglass size={18} aria-hidden />
      <div>
        <b>{title}</b>
        <p className="rl-banner-p">{lead}</p>
        {p.by === "other" && rollback ? (
          <button type="button" className="btn sm primary" disabled={busy} onClick={onConfirm}>
            {t("v7.ed.confirm.rollback", { n: p.version })}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EditorBody({
  initial,
  brains,
  admin,
  brain,
  onClose,
  onChanged,
}: {
  initial: RuleDetail | null;
  brains: BrainChoice[];
  admin: boolean;
  brain?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const text = useRuleText();
  const { say } = useApp();
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [detail, setDetail] = useState<RuleDetail | null>(initial);
  const [draft, setDraft] = useState<RuleDraft>(
    () => initial?.draft ?? blankDraft(brains, admin, brain),
  );
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<"edit" | "history">("edit");
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [checking, setChecking] = useState(false);
  const [valid, setValid] = useState<boolean | null>(null);
  const [needsSecond, setNeedsSecond] = useState(initial?.needsSecond ?? false);
  const [busy, setBusy] = useState<null | "save" | "publish" | "rollback">(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState<7 | 30>(7);
  const [sim, setSim] = useState<SimState>({ state: "idle" });
  const [stale, setStale] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ran = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useFocusTrap(root, true);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("input.rl-name")?.focus();
  }, []);

  const edit = (next: RuleDraft | ((d: RuleDraft) => RuleDraft)) => {
    setDraft(next);
    setDirty(true);
    setStale(true);
    setErr(null);
  };

  // Live validation, debounced. Nothing is shown for a brand new rule until its first edit.
  const seq = useRef(0);
  useEffect(() => {
    if (!initial && !dirty) return;
    const mine = ++seq.current;
    setChecking(true);
    const h = window.setTimeout(() => {
      rulesApi.validate(draft).then(
        (r) => {
          if (mine !== seq.current) return;
          setIssues([]);
          setValid(true);
          setNeedsSecond(r.needsSecond);
          setChecking(false);
        },
        (e: unknown) => {
          if (mine !== seq.current) return;
          const list = issuesOf(e);
          setIssues(list ?? []);
          setValid(false);
          setChecking(false);
          if (!list) setErr(e instanceof ApiError ? e.reason : t("v7.err.generic"));
        },
      );
    }, 350);
    return () => window.clearTimeout(h);
  }, [draft, dirty, initial, t]);

  const simulate = useCallback((d: RuleDraft, window_: 7 | 30) => {
    setSim((s) => ({
      state: "loading",
      last: s.state === "ok" ? s.data : s.state === "idle" ? null : s.last,
    }));
    rulesApi.simulate(d, window_).then(
      (data) => {
        setSim({ state: "ok", data });
        setStale(false);
      },
      () => setSim((s) => ({ state: "error", last: s.state === "loading" ? s.last : null })),
    );
  }, []);

  // Once when the editor opens (as soon as the rule checks out), then only on request.
  useEffect(() => {
    if (ran.current || valid !== true) return;
    ran.current = true;
    simulate(draftRef.current, days);
  }, [valid, days, simulate]);

  const bad = (prefix: string, exact = false) =>
    issues.filter((i) =>
      exact ? i.path === prefix : i.path === prefix || i.path.startsWith(`${prefix}.`),
    );
  const refused = valid === false;
  const status = draft.status;
  const pending = detail?.pending ?? null;
  const publishPending = pending?.kind === "publish" ? pending : null;
  const nextV = detail?.nextVersion ?? 1;
  const live = detail?.version ?? 0;

  const applyResult = (res: PublishResult, kind: "publish" | "rollback") => {
    setDetail(res.rule);
    setDraft(res.rule.draft);
    setDirty(false);
    setStale(false);
    onChanged();
    if (res.status === "published")
      say(t(kind === "publish" ? "v7.ed.published" : "v7.ed.rolledback", { n: res.version }));
    else if (res.sameActor) say(t("v7.ed.same"));
  };
  const fail = (e: unknown) => {
    const list = issuesOf(e);
    if (list) {
      setIssues(list);
      setValid(false);
      return;
    }
    setErr(
      e instanceof ApiError
        ? e.body.error === "scope_not_allowed"
          ? t("v7.err.scope_not_allowed")
          : e.reason
        : t("v7.err.generic"),
    );
  };

  /** Save the draft (create or update) and return the saved rule. */
  const persist = async (): Promise<RuleDetail> => {
    const saved = detail ? await rulesApi.save(detail.id, draft) : await rulesApi.create(draft);
    setDetail(saved);
    setDraft(saved.draft);
    setDirty(false);
    onChanged();
    return saved;
  };

  const saveDraft = async () => {
    setBusy("save");
    setErr(null);
    try {
      await persist();
      say(t("v7.ed.saved"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const publish = async () => {
    if (status === "draft") return;
    setBusy("publish");
    setErr(null);
    try {
      const saved = dirty || !detail ? await persist() : detail;
      applyResult(await rulesApi.publish(saved.id, saved.draftHash ?? "", status), "publish");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const rollback = async (to: number) => {
    if (!detail) return;
    setBusy("rollback");
    setErr(null);
    try {
      applyResult(await rulesApi.rollback(detail.id, to), "rollback");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!detail) return;
    try {
      await rulesApi.remove(detail.id);
      say(t("v7.ed.deleted"));
      onChanged();
      onClose();
    } catch (e) {
      fail(e);
    }
  };

  const setScope = (scope: RuleScope) => edit({ ...draft, scope });
  const scopeKinds: RuleScope["kind"][] = admin ? ["tenant", "brain_types", "brains"] : ["brains"];
  const scopeOptions: ChipOption[] =
    draft.scope.kind === "brain_types"
      ? (["team", "account", "global"] as const).map((x) => ({
          id: x,
          label: t(`v7.val.brain_type.${x}` as Key),
        }))
      : brains.map((b) => ({ id: b.id, label: b.label }));
  const scopeValues =
    draft.scope.kind === "brain_types"
      ? draft.scope.types
      : draft.scope.kind === "brains"
        ? draft.scope.ids
        : [];
  const effectIcon = (() => {
    const I = EFFECT_ICON[draft.then.effect];
    return <I size={16} aria-hidden />;
  })();

  const canPublish =
    status !== "draft" &&
    !refused &&
    !checking &&
    !busy &&
    publishPending?.by !== "you" &&
    !!draft.name.trim();
  const publishLabel =
    publishPending?.by === "other"
      ? t("v7.ed.confirm", { n: publishPending.version })
      : publishPending?.by === "you"
        ? t("v7.ed.waiting.short")
        : t("v7.ed.publish", { n: nextV });
  const title = draft.name.trim() || t("v7.ed.untitled");
  const subtitle = detail
    ? t(live > 0 ? "v7.version.line" : "v7.version.none", {
        n: live,
        who: text.who(detail.editedBy),
        when: text.ago(detail.editedAt),
      })
    : t("v7.version.new");
  const rowStatus: RuleStatus = detail?.status ?? "draft";
  const nameIssue = `${titleId}-name`;

  return (
    <div className="rl-sheet-back">
      <div
        ref={root}
        className="rl-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="rule-editor"
      >
        <header className="rl-sheet-head">
          <span className="rl-shield" aria-hidden>
            <Shield size={20} />
          </span>
          <div className="rl-sheet-title">
            <h2 id={titleId}>{title}</h2>
            <p className="rl-sub2">{subtitle}</p>
          </div>
          <span className={`rl-st ${rowStatus}`} data-testid="rule-status">
            {t(`v7.st.${rowStatus}` as Key)}
          </span>
          {detail ? (
            <button
              type="button"
              className="rl-icon"
              aria-label={t("v7.ed.history")}
              aria-pressed={view === "history"}
              onClick={() => setView((v) => (v === "history" ? "edit" : "history"))}
            >
              <HistoryIcon size={18} aria-hidden />
            </button>
          ) : null}
          <button type="button" className="rl-icon" aria-label={t("v7.ed.close")} onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </header>

        {view === "history" && detail ? (
          <div className="rl-sheet-body single">
            <Banner
              detail={detail}
              busy={!!busy}
              onConfirm={() => detail.pending && rollback(detail.pending.version)}
            />
            <button type="button" className="rl-link back" onClick={() => setView("edit")}>
              {t("v7.ed.back")}
            </button>
            <History detail={detail} canEdit busy={!!busy} onRollback={rollback} />
          </div>
        ) : (
          <div className="rl-sheet-body">
            <div className="rl-form">
              {detail ? (
                <Banner
                  detail={detail}
                  busy={!!busy}
                  onConfirm={() => detail.pending && rollback(detail.pending.version)}
                />
              ) : null}
              <div className="rl-field">
                <label className="rl-lbl" htmlFor={`${titleId}-n`}>
                  {t("v7.ed.name")}
                </label>
                <input
                  id={`${titleId}-n`}
                  className="rl-input rl-name"
                  value={draft.name}
                  placeholder={t("v7.ed.name.ph")}
                  aria-invalid={bad("name").length > 0 || undefined}
                  aria-describedby={bad("name").length ? nameIssue : undefined}
                  onChange={(e) => edit({ ...draft, name: e.target.value })}
                />
                <Issue id={nameIssue} items={bad("name")} />
              </div>

              <h3 className="rl-cap">{t("v7.ed.when")}</h3>
              <div className="rl-group" data-testid="rule-when">
                {draft.when.map((c, i) => (
                  <div key={i}>
                    {i > 0 ? (
                      <div className="rl-and" aria-hidden data-testid="rule-and">
                        {t("v7.ed.and")}
                      </div>
                    ) : null}
                    <ConditionRow
                      n={i + 1}
                      c={c}
                      canRemove={draft.when.length > 1}
                      brains={brains}
                      issues={issues.filter(
                        (x) => x.path === `when.${i}` || x.path.startsWith(`when.${i}.`),
                      )}
                      onChange={(nc) =>
                        edit({ ...draft, when: draft.when.map((x, j) => (j === i ? nc : x)) })
                      }
                      onRemove={() =>
                        edit({ ...draft, when: draft.when.filter((_, j) => j !== i) })
                      }
                    />
                  </div>
                ))}
                <Issue id={`${titleId}-when`} items={bad("when", true)} />
                {draft.when.length < 8 ? (
                  <button
                    type="button"
                    className="rl-add"
                    onClick={() => edit({ ...draft, when: [...draft.when, blankCondition()] })}
                  >
                    {t("v7.ed.add")} <Plus size={14} aria-hidden />
                  </button>
                ) : null}
              </div>

              <h3 className="rl-cap">{t("v7.ed.then")}</h3>
              <div className="rl-group rl-then" data-testid="rule-then">
                <div className="rl-trow">
                  <label className="rl-tlbl" htmlFor={`${titleId}-eff`}>
                    {t("v7.ed.effect")}
                  </label>
                  <div className="rl-tval">
                    <SelectBox
                      id={`${titleId}-eff`}
                      label={t("v7.ed.effect")}
                      value={draft.then.effect}
                      icon={effectIcon}
                      invalid={bad("then.effect").length > 0}
                      describedBy={bad("then.effect").length ? `${titleId}-eff-i` : undefined}
                      onChange={(e) => edit(withThen(draft, thenFor(e as RuleEffect, draft.then)))}
                    >
                      {RULE_EFFECTS.map((e) => (
                        <option key={e} value={e}>
                          {text.effectLabel(e)}
                        </option>
                      ))}
                    </SelectBox>
                    <Issue id={`${titleId}-eff-i`} items={bad("then.effect")} />
                  </div>
                </div>
                {draft.then.effect === "group" ? (
                  <div className="rl-trow" data-testid="rule-approvers">
                    <span className="rl-tlbl">{t("v7.ed.approvers")}</span>
                    <div className="rl-tval">
                      <ChipsInput
                        label={t("v7.ed.approvers")}
                        values={draft.then.approvers ?? []}
                        options={GROUPS.map((g) => ({
                          id: g,
                          label: t(`v7.val.group.${g}` as Key),
                        }))}
                        invalid={bad("then.approvers").length > 0}
                        describedBy={bad("then.approvers").length ? `${titleId}-app-i` : undefined}
                        onChange={(v) =>
                          edit(
                            withThen(draft, {
                              ...draft.then,
                              approvers: v as ("stewards" | "privacy")[],
                            }),
                          )
                        }
                      />
                      <Issue id={`${titleId}-app-i`} items={bad("then.approvers")} />
                    </div>
                  </div>
                ) : null}
                {draft.then.effect === "expire" ? (
                  <div className="rl-trow" data-testid="rule-expires">
                    <label className="rl-tlbl" htmlFor={`${titleId}-exp`}>
                      {t("v7.ed.expires")}
                    </label>
                    <div className="rl-tval">
                      <div className="rl-inline">
                        <input
                          id={`${titleId}-exp`}
                          className="rl-input num"
                          type="number"
                          min={1}
                          max={1440}
                          value={draft.then.expiresAfterMin ?? ""}
                          aria-invalid={bad("then.expiresAfterMin").length > 0 || undefined}
                          aria-describedby={
                            bad("then.expiresAfterMin").length ? `${titleId}-exp-i` : undefined
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            const { expiresAfterMin: _drop, ...rest } = draft.then;
                            edit(
                              withThen(
                                draft,
                                raw === "" ? rest : { ...rest, expiresAfterMin: Number(raw) },
                              ),
                            );
                          }}
                        />
                        <span className="muted">{t("v7.ed.min")}</span>
                      </div>
                      <Issue id={`${titleId}-exp-i`} items={bad("then.expiresAfterMin")} />
                    </div>
                  </div>
                ) : null}
                {draft.then.effect === "block" ? (
                  <div className="rl-trow" data-testid="rule-message">
                    <label className="rl-tlbl" htmlFor={`${titleId}-msg`}>
                      {t("v7.ed.message")}
                    </label>
                    <div className="rl-tval">
                      <textarea
                        id={`${titleId}-msg`}
                        className="rl-input rl-area"
                        rows={2}
                        value={draft.then.message ?? ""}
                        placeholder={t("v7.ed.message.ph")}
                        aria-invalid={bad("then.message").length > 0 || undefined}
                        aria-describedby={
                          bad("then.message").length ? `${titleId}-msg-i` : undefined
                        }
                        onChange={(e) =>
                          edit(withThen(draft, { ...draft.then, message: e.target.value }))
                        }
                      />
                      <span className="rl-count-hint muted">
                        {t("v7.ed.message.count", { n: (draft.then.message ?? "").length })}
                      </span>
                      <Issue id={`${titleId}-msg-i`} items={bad("then.message")} />
                    </div>
                  </div>
                ) : null}
              </div>

              <h3 className="rl-cap">{t("v7.ed.except")}</h3>
              <div className="rl-group rl-except">
                <div className="rl-exrow">
                  <CircleAlert size={16} aria-hidden />
                  <span id={`${titleId}-inc`}>{t("v7.ed.incident")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.except.incident}
                    aria-labelledby={`${titleId}-inc`}
                    className="rl-switch"
                    data-testid="rule-incident-switch"
                    onClick={() => edit({ ...draft, except: { incident: !draft.except.incident } })}
                  >
                    <span />
                  </button>
                </div>
                <Issue id={`${titleId}-ex-i`} items={bad("except")} />
              </div>

              <div className="rl-meta2">
                <div className="rl-field">
                  <span className="rl-lbl" id={`${titleId}-scope`}>
                    {t("v7.scope.label")}
                  </span>
                  <div className="rl-scope">
                    <SelectBox
                      label={t("v7.scope.label")}
                      value={draft.scope.kind}
                      describedBy={bad("scope").length ? `${titleId}-scope-i` : undefined}
                      invalid={bad("scope").length > 0}
                      disabled={scopeKinds.length < 2}
                      onChange={(k) =>
                        setScope(
                          k === "tenant"
                            ? { kind: "tenant" }
                            : k === "brain_types"
                              ? { kind: "brain_types", types: [] }
                              : {
                                  kind: "brains",
                                  ids: admin ? [] : brains[0] ? [brains[0].id] : [],
                                },
                        )
                      }
                    >
                      {scopeKinds.map((k) => (
                        <option key={k} value={k}>
                          {t(`v7.scope.${k}` as Key)}
                        </option>
                      ))}
                    </SelectBox>
                    {draft.scope.kind !== "tenant" ? (
                      <div className="rl-cond-val">
                        <ChipsInput
                          label={t("v7.scope.values")}
                          values={scopeValues}
                          options={scopeOptions}
                          invalid={bad("scope").length > 0}
                          describedBy={bad("scope").length ? `${titleId}-scope-i` : undefined}
                          onChange={(v) =>
                            setScope(
                              draft.scope.kind === "brain_types"
                                ? {
                                    kind: "brain_types",
                                    types: v as ("team" | "account" | "global")[],
                                  }
                                : { kind: "brains", ids: v },
                            )
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                  <Issue id={`${titleId}-scope-i`} items={bad("scope")} />
                </div>

                <fieldset className="rl-status">
                  <legend className="rl-lbl">{t("v7.ed.status")}</legend>
                  <div className="rl-seg">
                    {STATUSES.map((s) => (
                      <label key={s} className={draft.status === s ? "on" : ""}>
                        <input
                          type="radio"
                          name={`${titleId}-status`}
                          value={s}
                          checked={draft.status === s}
                          onChange={() => edit({ ...draft, status: s })}
                        />
                        <span className="rl-seg-t">{t(`v7.st.${s}` as Key)}</span>
                      </label>
                    ))}
                  </div>
                  <p className="rl-fine">{t(`v7.st.note.${draft.status}` as Key)}</p>
                  {status === "draft" ? (
                    <p className="rl-fine">{t("v7.ed.status.draft.hint")}</p>
                  ) : null}
                  <Issue id={`${titleId}-st-i`} items={bad("status")} />
                </fieldset>
              </div>

              <div className="rl-notes" aria-live="polite">
                {checking ? <p className="rl-fine">{t("v7.ed.checking")}</p> : null}
                {refused && !checking ? <p className="rl-fine bad">{t("v7.ed.refused")}</p> : null}
                {needsSecond && !refused ? (
                  <p className="rl-fine">{t("v7.ed.hint.needs")}</p>
                ) : null}
                {err ? (
                  <p className="rl-issue" role="alert">
                    <CircleAlert size={14} aria-hidden /> <span>{err}</span>
                  </p>
                ) : null}
              </div>
              {detail && live === 0 && !publishPending ? (
                <div className="rl-del">
                  {confirmDelete ? (
                    <>
                      <span>{t("v7.ed.delete.ask")}</span>
                      <button type="button" className="btn sm danger" onClick={remove}>
                        {t("v7.ed.delete.yes")}
                      </button>
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => setConfirmDelete(false)}
                      >
                        {t("common.cancel")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="rl-link"
                      onClick={() => setConfirmDelete(true)}
                    >
                      {t("v7.ed.delete")}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            <Impact
              sim={sim}
              days={days}
              stale={stale && sim.state !== "idle"}
              onDays={(d) => {
                setDays(d);
                simulate(draft, d);
              }}
            />
          </div>
        )}

        <footer className="rl-sheet-foot">
          <button
            type="button"
            className="rl-ghost"
            disabled={refused || sim.state === "loading"}
            onClick={() => simulate(draft, days)}
          >
            <FlaskConical size={16} aria-hidden /> {t("v7.ed.sim")}
          </button>
          <span className="rl-spacer" />
          <button
            type="button"
            className="btn rl-save"
            disabled={!!busy || !draft.name.trim() || (!dirty && !!detail)}
            onClick={saveDraft}
          >
            {t("v7.ed.save")}
          </button>
          <button
            type="button"
            className="btn primary rl-publish"
            disabled={!canPublish}
            onClick={publish}
            data-testid="rule-publish"
          >
            <BadgeCheck size={16} aria-hidden /> {publishLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** The rule editor as a side sheet over the list. `ruleId` null is a new rule. */
export function RuleEditor({
  ruleId,
  brains,
  admin,
  brain,
  onClose,
  onChanged,
}: {
  ruleId: string | null;
  brains: BrainChoice[];
  admin: boolean;
  /** The brain whose Rules tab this is: a new rule starts scoped to it. */
  brain?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const detail = useApi(() => (ruleId ? rulesApi.get(ruleId) : Promise.resolve(null)), [ruleId]);
  if (detail.loading && !detail.data && ruleId)
    return (
      <div className="rl-sheet-back">
        <div className="rl-sheet" role="dialog" aria-modal="true" aria-label={t("v7.ed.dialog")}>
          <Skeleton n={3} />
        </div>
      </div>
    );
  if (detail.error && ruleId)
    return (
      <div className="rl-sheet-back">
        <div className="rl-sheet" role="dialog" aria-modal="true" aria-label={t("v7.ed.dialog")}>
          <p className="errorbox" role="alert">
            {detail.error}
          </p>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    );
  return (
    <EditorBody
      key={detail.data?.id ?? "new"}
      initial={detail.data}
      brains={brains}
      admin={admin}
      brain={brain}
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}
