import { ArrowLeft, Lock, Pencil, Plus } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import {
  Chip,
  Empty,
  ErrorBox,
  fmtDate,
  fmtRev,
  PlaneBadge,
  Skeleton,
  statusTone,
  useStatus,
} from "../components/ui";
import { type Key, useI18n } from "../i18n";
import type {
  AccountDetail,
  AccountRec,
  AccountRecord,
  AccountRecords,
  RecordSection,
} from "../types";
import { useApi } from "../useApi";
import { PrepareBrief } from "./brief/PrepareBrief";

const RECORD_SECTIONS: RecordSection[] = ["dec", "com", "risk", "out"];
const TAB_ORDER = ["eng", "dec", "com", "out", "risk", "meetings", "bids", "con"];
const STATUSES: Record<RecordSection, string[]> = {
  dec: ["open", "decided"],
  com: ["open", "in progress", "done"],
  risk: ["open", "mitigating", "closed"],
  out: ["draft", "ready"],
};

function SeedStory({ r }: { r: AccountRecord }) {
  const { t } = useI18n();
  if (!r.story) return null;
  const ext = r.story.external;
  return (
    <div className="story">
      <div>
        <strong>{t("acc.story.internal")}</strong>
        <div className="muted">{r.story.internal ? t("acc.ready") : t("acc.notwritten")}</div>
      </div>
      <div>
        <strong>{t("acc.story.lesson")}</strong>
        <div className="muted">{r.story.lesson ? t("acc.ready") : t("acc.notwritten")}</div>
      </div>
      <div className={ext.available ? "" : "locked"}>
        <strong>{ext.available ? t("acc.story.external") : t("acc.story.external.locked")}</strong>
        <div className="muted">
          {ext.available ? "" : <Lock size={12} aria-hidden style={{ verticalAlign: -1 }} />}{" "}
          {ext.available ? t("acc.perm.onrecord") : t("acc.perm.none")}
        </div>
      </div>
    </div>
  );
}

function Story({
  accountId,
  rec,
  canEdit,
  onChanged,
}: {
  accountId: string;
  rec: AccountRec;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const story = rec.story;
  const [ext, setExt] = useState(story?.external.text ?? "");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!story) return null;
  const granted = story.external.available;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ marginTop: 10 }}>
      <div className="story">
        <div>
          <strong>{t("acc.story.internal")}</strong>
          <div style={{ whiteSpace: "pre-wrap" }} className={story.internal ? "" : "muted"}>
            {story.internal || t("acc.notwritten")}
          </div>
        </div>
        <div>
          <strong>{t("acc.story.lesson")}</strong>
          <div style={{ whiteSpace: "pre-wrap" }} className={story.lesson ? "" : "muted"}>
            {story.lesson || t("acc.notwritten")}
          </div>
        </div>
        <div className={granted ? "" : "locked"}>
          <strong>{granted ? t("acc.story.external") : t("acc.story.external.locked")}</strong>
          {granted ? (
            <div style={{ whiteSpace: "pre-wrap" }} className={story.external.text ? "" : "muted"}>
              {story.external.text || t("acc.notwritten")}
            </div>
          ) : (
            <div className="muted">
              <Lock size={12} aria-hidden style={{ verticalAlign: -1 }} /> {t("acc.perm.none")}
            </div>
          )}
        </div>
      </div>
      {granted && story.permission ? (
        <p className="muted" style={{ fontSize: 14 }}>
          {t("acc.perm.by", {
            ref: story.permission.reference,
            date: fmtDate(story.permission.at),
          })}
        </p>
      ) : null}
      {canEdit ? (
        <div className="stack">
          {granted ? (
            <>
              <div className="field">
                <label htmlFor={`ext-${rec.id}`}>{t("acc.story.external.edit")}</label>
                <textarea
                  id={`ext-${rec.id}`}
                  className="textarea"
                  style={{ minHeight: 90 }}
                  maxLength={8000}
                  value={ext}
                  onChange={(e) => setExt(e.target.value)}
                />
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy || ext === (story.external.text ?? "")}
                  onClick={() =>
                    run(() =>
                      api.recordUpdate(accountId, rec.id, {
                        revision: rec.revision,
                        story: { internal: story.internal, lesson: story.lesson, external: ext },
                      }),
                    )
                  }
                >
                  {t("acc.story.external.save")}
                </button>
                <button
                  type="button"
                  className="btn sm ghost"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      api.recordPermission(accountId, rec.id, {
                        revision: rec.revision,
                        granted: false,
                      }),
                    )
                  }
                >
                  {t("acc.perm.withdraw")}
                </button>
              </div>
            </>
          ) : (
            <div className="stack">
              <div className="field">
                <label htmlFor={`ref-${rec.id}`}>{t("acc.perm.ref")}</label>
                <input
                  id={`ref-${rec.id}`}
                  className="input"
                  value={ref}
                  maxLength={200}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder={t("acc.perm.ref.ph")}
                />
              </div>
              <div>
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy || ref.trim().length < 3}
                  onClick={() =>
                    run(() =>
                      api.recordPermission(accountId, rec.id, {
                        revision: rec.revision,
                        granted: true,
                        reference: ref.trim(),
                      }),
                    )
                  }
                >
                  {t("acc.perm.record")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {err ? <ErrorBox message={err} /> : null}
    </div>
  );
}

function RecordForm({
  accountId,
  section,
  rec,
  roles,
  onDone,
  onCancel,
}: {
  accountId: string;
  section: RecordSection;
  rec?: AccountRec;
  roles: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const sl = useStatus();
  const [title, setTitle] = useState(rec?.title ?? "");
  const [note, setNote] = useState(rec?.note ?? "");
  const [ownerRole, setOwnerRole] = useState(rec?.ownerRole ?? "");
  const [due, setDue] = useState(rec?.due ?? "");
  const [status, setStatus] = useState(rec?.status ?? STATUSES[section][0] ?? "open");
  const [internal, setInternal] = useState(rec?.story?.internal ?? "");
  const [lesson, setLesson] = useState(rec?.story?.lesson ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = rec?.id ?? `new-${section}`;
  const showDue = section === "com" || section === "dec" || section === "risk";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const common = {
        title: title.trim(),
        note: note.trim(),
        ownerRole,
        status,
        ...(section !== "out" ? { due: due || null } : {}),
      };
      const story =
        section === "out"
          ? { internal, lesson, external: rec?.story?.external.text ?? "" }
          : undefined;
      if (rec)
        await api.recordUpdate(accountId, rec.id, {
          revision: rec.revision,
          ...common,
          ...(story ? { story } : {}),
        });
      else
        await api.recordCreate(accountId, {
          section,
          ...common,
          ...(story ? { story: { ...story, external: "" } } : {}),
        });
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} aria-label={t(`acc.form.${section}` as Key)}>
      <div className="field">
        <label htmlFor={`${id}-title`}>{t("acc.f.title")}</label>
        <input
          id={`${id}-title`}
          className="input"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="grid cols-2" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor={`${id}-owner`}>{t("acc.f.owner")}</label>
          <select
            id={`${id}-owner`}
            className="select"
            style={{ borderRadius: 10 }}
            value={ownerRole}
            onChange={(e) => setOwnerRole(e.target.value)}
          >
            <option value="">{t("acc.f.owner.none")}</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        {showDue ? (
          <div className="field">
            <label htmlFor={`${id}-due`}>{t("acc.f.due")}</label>
            <input
              id={`${id}-due`}
              className="input"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={`${id}-status`}>{t("acc.f.status")}</label>
          <select
            id={`${id}-status`}
            className="select"
            style={{ borderRadius: 10 }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES[section].map((s) => (
              <option key={s} value={s}>
                {sl(s)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-note`}>{t("acc.f.note")}</label>
        <textarea
          id={`${id}-note`}
          className="textarea"
          style={{ minHeight: 80 }}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {section === "out" ? (
        <>
          <div className="field">
            <label htmlFor={`${id}-int`}>{t("acc.f.internal")}</label>
            <textarea
              id={`${id}-int`}
              className="textarea"
              style={{ minHeight: 80 }}
              maxLength={8000}
              value={internal}
              onChange={(e) => setInternal(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-les`}>{t("acc.f.lesson")}</label>
            <textarea
              id={`${id}-les`}
              className="textarea"
              style={{ minHeight: 80 }}
              maxLength={8000}
              value={lesson}
              onChange={(e) => setLesson(e.target.value)}
            />
          </div>
          <p className="muted" style={{ fontSize: 14 }}>
            <Lock size={12} aria-hidden style={{ verticalAlign: -1 }} /> {t("acc.f.external.hint")}
          </p>
        </>
      ) : null}
      {err ? <ErrorBox message={err} /> : null}
      <div className="row">
        <button type="submit" className="btn primary sm" disabled={busy || !title.trim()}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

function RecordCard({
  accountId,
  rec,
  canEdit,
  roles,
  onChanged,
}: {
  accountId: string;
  rec: AccountRec;
  canEdit: boolean;
  roles: string[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const sl = useStatus();
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <li>
        <RecordForm
          accountId={accountId}
          section={rec.section}
          rec={rec}
          roles={roles}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  return (
    <li className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{rec.title}</strong>
        <span className="row">
          {rec.overdue ? <Chip tone="risk">{t("today.overdue")}</Chip> : null}
          <Chip tone={statusTone(rec.status)}>{sl(rec.status)}</Chip>
          <span className="muted">{fmtRev(rec.revision)}</span>
        </span>
      </div>
      <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
        {rec.ownerRole ? t("acc.owner", { role: rec.ownerRole }) : t("acc.owner.none")}
        {rec.due ? ` · ${t("today.due", { date: fmtDate(rec.due) })}` : ""}
      </p>
      {rec.note ? <p style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{rec.note}</p> : null}
      <Story accountId={accountId} rec={rec} canEdit={canEdit} onChanged={onChanged} />
      {canEdit ? (
        <p style={{ marginTop: 10 }}>
          <button type="button" className="btn sm ghost" onClick={() => setEditing(true)}>
            <Pencil size={14} aria-hidden /> {t("common.edit")}
            <span className="sr-only"> {rec.title}</span>
          </button>
        </p>
      ) : null}
    </li>
  );
}

function Overview({
  d,
  rec,
  go,
}: {
  d: AccountDetail;
  rec: AccountRecords | null;
  go: (k: string) => void;
}) {
  const { t, td } = useI18n();
  const records = rec?.records ?? [];
  const open = records.filter(
    (r) => r.section !== "out" && !["decided", "done", "closed", "ready"].includes(r.status),
  );
  const overdue = open.filter((r) => r.overdue);
  const counts = (key: string) =>
    (d.sections.find((s) => s.key === key)?.items.length ?? 0) +
    records.filter((r) => r.section === key).length;
  return (
    <div className="stack">
      <div className="kpis">
        {TAB_ORDER.filter((k) => k !== "con").map((k) => (
          <button
            type="button"
            className="kpi"
            key={k}
            onClick={() => go(k)}
            style={{ textAlign: "left", cursor: "pointer" }}
          >
            <b>{counts(k)}</b>
            <span className="muted">
              {td("acc.tab", k, d.sections.find((s) => s.key === k)?.label ?? k)}
            </span>
          </button>
        ))}
      </div>
      <section className="card" aria-labelledby="ov-attn">
        <h3 id="ov-attn">{t("acc.ov.attention")}</h3>
        {open.length === 0 ? (
          <p className="muted">{t("acc.ov.none")}</p>
        ) : (
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {open.slice(0, 8).map((r) => (
              <li key={r.id} className="attn-row">
                <div>
                  <strong>{r.title}</strong>
                  <div className="muted" style={{ fontSize: 14 }}>
                    {td("acc.tab", r.section)}
                    {r.due ? ` · ${t("today.due", { date: fmtDate(r.due) })}` : ""}
                  </div>
                </div>
                {r.overdue ? <Chip tone="risk">{t("today.overdue")}</Chip> : null}
              </li>
            ))}
          </ul>
        )}
        {overdue.length > 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>
            {t("acc.ov.overdue", { n: overdue.length })}
          </p>
        ) : null}
      </section>
      <p className="muted" style={{ fontSize: 14 }}>
        {t("acc.contacts.note")}
      </p>
    </div>
  );
}

export function AccountWorkspace() {
  const { id = "" } = useParams();
  const { t, td } = useI18n();
  const sl = useStatus();
  const state = useApi(() => api.account(id), [id]);
  const recs = useApi(() => api.records(id), [id]);
  const [tab, setTab] = useState("overview");
  const [adding, setAdding] = useState(false);

  const d = state.data;
  const records = recs.data;
  const tabs = useMemo(() => {
    if (!d) return [];
    const have = new Map(d.sections.map((s) => [s.key, s.label]));
    // The four sections members write to always have a tab, so there is somewhere to start.
    const keys = [
      ...new Set([
        ...TAB_ORDER.filter((k) => have.has(k) || RECORD_SECTIONS.includes(k as RecordSection)),
        ...d.sections.map((s) => s.key),
      ]),
    ];
    return [
      { key: "overview", label: t("acc.tab.overview") },
      ...keys.map((k) => ({ key: k, label: td("acc.tab", k, have.get(k) ?? k) })),
    ];
  }, [d, t, td]);

  const reloadAll = () => {
    state.reload();
    recs.reload();
  };

  if (state.loading && !d)
    return (
      <div className="page">
        <Skeleton n={3} />
      </div>
    );

  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((s) => s.key === tab);
    const next =
      e.key === "ArrowRight"
        ? i + 1
        : e.key === "ArrowLeft"
          ? i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    const s = tabs[(next + tabs.length) % tabs.length];
    if (s) {
      setTab(s.key);
      setAdding(false);
      document.getElementById(`tab-${s.key}`)?.focus();
    }
  };

  const section = d?.sections.find((s) => s.key === tab);
  const isRecordTab = RECORD_SECTIONS.includes(tab as RecordSection);
  const myRecs = (records?.records ?? []).filter((r) => r.section === tab);
  const canEdit = records?.canEdit ?? false;
  const roles = records?.ownerRoles ?? [];
  const seedItems = section?.items ?? [];
  const nothing = seedItems.length === 0 && myRecs.length === 0;

  return (
    <div className="page">
      <p style={{ marginBottom: 16 }}>
        <Link className="btn sm ghost" to="/accounts">
          <ArrowLeft size={14} aria-hidden /> {t("acc.back")}
        </Link>
      </p>
      {state.error ? <ErrorBox message={state.error} onRetry={state.reload} /> : null}
      {d ? (
        <>
          <header className="page-head">
            <div className="row">
              <PlaneBadge plane={d.account.plane} />
              <Chip tone={statusTone(d.account.aiProcessing)}>
                {t("acc.ai", { state: sl(d.account.aiProcessing) })}
              </Chip>
              <Chip tone={statusTone(d.account.status)}>{d.account.status}</Chip>
            </div>
            <h2>{d.account.name}</h2>
            <p>
              {d.account.country} · {d.account.region} · {d.account.sector}
            </p>
            <p className="muted" style={{ fontSize: 14 }}>
              {t("acc.contacts.note")}
            </p>
          </header>
          <PrepareBrief accountId={d.account.id} aiProcessing={d.account.aiProcessing} />
          <div className="tabs" role="tablist" aria-label={t("acc.sections")} onKeyDown={onKey}>
            {tabs.map((s) => (
              <button
                key={s.key}
                id={`tab-${s.key}`}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === s.key}
                aria-controls="tabpanel"
                tabIndex={tab === s.key ? 0 : -1}
                onClick={() => {
                  setTab(s.key);
                  setAdding(false);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === "overview" ? (
              <Overview
                d={d}
                rec={records ?? null}
                go={(k) => {
                  setTab(k);
                }}
              />
            ) : (
              <div className="stack">
                {isRecordTab && canEdit && !adding ? (
                  <div>
                    <button
                      type="button"
                      className="btn primary sm"
                      onClick={() => setAdding(true)}
                    >
                      <Plus size={14} aria-hidden /> {t(`acc.add.${tab}` as Key)}
                    </button>
                  </div>
                ) : null}
                {adding && isRecordTab ? (
                  <RecordForm
                    accountId={id}
                    section={tab as RecordSection}
                    roles={roles}
                    onDone={() => {
                      setAdding(false);
                      reloadAll();
                    }}
                    onCancel={() => setAdding(false)}
                  />
                ) : null}
                {recs.error ? <ErrorBox message={recs.error} onRetry={recs.reload} /> : null}
                {nothing && !adding ? (
                  <Empty title={t("acc.empty.title")}>
                    {t(`acc.empty.${tab}` as Key)}{" "}
                    {isRecordTab
                      ? canEdit
                        ? t("acc.empty.canadd")
                        : t("acc.empty.cannotadd")
                      : ""}
                  </Empty>
                ) : (
                  <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {myRecs.map((r) => (
                      <RecordCard
                        key={r.id}
                        accountId={id}
                        rec={r}
                        canEdit={canEdit}
                        roles={roles}
                        onChanged={reloadAll}
                      />
                    ))}
                    {seedItems.map((r) => (
                      <li className="card" key={r.id}>
                        <div className="row" style={{ justifyContent: "space-between" }}>
                          <strong>{r.title}</strong>
                          <span className="row">
                            <Chip tone={statusTone(r.status)}>{sl(r.status)}</Chip>
                            <span className="muted">{fmtRev(r.revision)}</span>
                          </span>
                        </div>
                        {r.note ? (
                          <p className="muted" style={{ marginTop: 6 }}>
                            {r.note}
                          </p>
                        ) : null}
                        <SeedStory r={r} />
                        {tab === "meetings" ? (
                          <PrepareBrief
                            accountId={d.account.id}
                            meetingId={r.id}
                            label="Prepare brief for this meeting"
                            aiProcessing={d.account.aiProcessing}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
