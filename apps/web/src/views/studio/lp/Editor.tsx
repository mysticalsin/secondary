import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../../api";
import { Await, ErrorBox } from "../../../components/ui";
import { useI18n } from "../../../i18n";
import { lp } from "../../../lp/api";
import {
  type LandingDraft,
  type LpChecks,
  type LpContact,
  type LpIssue,
  type LpReference,
  type LpSlots,
  type LpStatus,
  SLOT_IDS,
  type SlotId,
} from "../../../lp/types";
import { useApp } from "../../../state";
import { useApi } from "../../../useApi";
import { DeviceToggle } from "./DeviceToggle";
import { ChecksPanel, ContactPanel, ReferencesPanel } from "./Panels";
import { type Device, Frame, PagePreview } from "./Preview";
import { LockedNote, PublishedPanel, PublishPanel, StatusChip } from "./Publish";
import "./lp.css";

type Tab = "refs" | "checks" | "contact";
type Save = "saved" | "pending" | "saving" | "error" | "conflict";
interface Body {
  slots: LpSlots;
  references: LpReference[];
  contact: LpContact;
}

const DEBOUNCE_MS = 700;

export function LpEditorPage() {
  const { id = "" } = useParams();
  return <LpEditor id={id} />;
}

export function LpEditor({ id }: { id: string }) {
  const state = useApi(() => lp.get(id), [id]);
  return (
    <div className="page lp-editor">
      <Await state={state} skeleton={3}>
        {(d) => <EditorBody key={d.id} initial={d} />}
      </Await>
    </div>
  );
}

function EditorBody({ initial }: { initial: LandingDraft }) {
  const { t, tn } = useI18n();
  const { say } = useApp();
  const id = initial.id;
  const [body, setBody] = useState<Body>({
    slots: initial.slots,
    references: initial.references,
    contact: initial.contact,
  });
  const [meta, setMeta] = useState({
    status: initial.status as LpStatus,
    url: initial.url,
    expiresAt: initial.expiresAt,
  });
  const [save, setSave] = useState<Save>("saved");
  const [saveErr, setSaveErr] = useState("");
  const [checks, setChecks] = useState<LpChecks | null>(initial.checks ?? null);
  const [checking, setChecking] = useState(false);
  const [device, setDevice] = useState<Device>("desktop");
  const [actual, setActual] = useState(false);
  const [tab, setTab] = useState<Tab>("refs");
  const [submitting, setSubmitting] = useState(false);
  const [blockedMsg, setBlockedMsg] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const checksHead = useRef<HTMLHeadingElement>(null);

  const draftRef = useRef<Body>(body);
  const rev = useRef(initial.revision);
  const dirty = useRef(false);
  const stopped = useRef(false);
  const running = useRef<Promise<void> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  const editable = meta.status === "draft";
  const open = checks?.issues.length ?? 0;

  const runCheck = useCallback(async (): Promise<LpChecks | null> => {
    setChecking(true);
    try {
      const c = await lp.check(id);
      if (mounted.current) setChecks(c);
      return c;
    } catch (e) {
      if (mounted.current) setErr(e instanceof ApiError ? e.reason : t("common.failed"));
      return null;
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, [id, t]);

  /** Save what is pending. Resolves true when nothing unsaved is left. */
  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    if (running.current) await running.current;
    while (dirty.current && !stopped.current && mounted.current) {
      const sent = draftRef.current;
      dirty.current = false;
      setSave("saving");
      const p = (async () => {
        try {
          const res = await lp.save(id, { ...sent, revision: rev.current });
          rev.current = res.revision;
        } catch (e) {
          dirty.current = true;
          stopped.current = true;
          if (e instanceof ApiError && e.status === 409) setSave("conflict");
          else {
            setSaveErr(e instanceof ApiError ? e.reason : t("common.failed"));
            setSave("error");
          }
        }
      })();
      running.current = p;
      await p;
      running.current = null;
    }
    if (!dirty.current && mounted.current) {
      setSave("saved");
      void runCheck();
    }
    return !dirty.current;
  }, [id, runCheck, t]);

  const edit = useCallback(
    (patch: Partial<Body>, now = false) => {
      draftRef.current = { ...draftRef.current, ...patch };
      setBody(draftRef.current);
      dirty.current = true;
      stopped.current = false;
      setSave("pending");
      setBlockedMsg(false);
      window.clearTimeout(timer.current);
      if (now) void flush();
      else timer.current = window.setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush],
  );

  // A page that opens as a draft shows where it stands before the person touches it.
  useEffect(() => {
    if (initial.status === "draft" && !initial.checks) void runCheck();
  }, [initial.status, initial.checks, runCheck]);

  const keepMine = async () => {
    try {
      const latest = await lp.get(id);
      rev.current = latest.revision;
      dirty.current = true;
      stopped.current = false;
      await flush();
    } catch (e) {
      setSaveErr(e instanceof ApiError ? e.reason : t("common.failed"));
      setSave("error");
    }
  };
  const loadLatest = async () => {
    try {
      const latest = await lp.get(id);
      rev.current = latest.revision;
      draftRef.current = {
        slots: latest.slots,
        references: latest.references,
        contact: latest.contact,
      };
      setBody(draftRef.current);
      dirty.current = false;
      stopped.current = false;
      setSave("saved");
      void runCheck();
    } catch (e) {
      setSaveErr(e instanceof ApiError ? e.reason : t("common.failed"));
      setSave("error");
    }
  };

  const fix = (i: LpIssue) => {
    if (!i.fix) return;
    if (i.fix.removeReference)
      edit(
        { references: body.references.filter((r) => r.pageId !== i.fix?.removeReference) },
        true,
      );
    else if (i.fix.text !== undefined && (SLOT_IDS as readonly string[]).includes(i.slot))
      edit({ slots: { ...body.slots, [i.slot]: i.fix.text } }, true);
    checksHead.current?.focus();
  };

  const submit = async () => {
    setErr(null);
    if (open > 0) {
      setBlockedMsg(true);
      setTab("checks");
      checksHead.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      if (!(await flush())) return;
      const c = await runCheck();
      if (!c) return;
      if (!c.ok) {
        setBlockedMsg(true);
        setTab("checks");
        return;
      }
      const d = await lp.submit(id);
      setMeta((m) => ({ ...m, status: d.status }));
      say(t("lp.submit.done"));
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };

  const flagged = new Set((checks?.issues ?? []).map((i) => i.slot));
  const title = t("lp.e.title", { role: initial.prospect.role, company: initial.prospect.company });
  const pageLang = initial.lang;
  const tabs: [Tab, string][] = [
    ["refs", t("lp.tab.refs")],
    ["checks", open ? `${t("lp.tab.checks")} (${open})` : t("lp.tab.checks")],
    ["contact", t("lp.tab.contact")],
  ];

  return (
    <>
      <Link to="/studio" className="lp-back">
        <ArrowLeft size={16} aria-hidden /> {t("lp.back")}
      </Link>
      <header className="lp-head">
        <div>
          <h2>{title}</h2>
          <p className="muted">
            {initial.prospect.firstName ? t("lp.e.for", { name: initial.prospect.firstName }) : ""}
          </p>
        </div>
        <div className="lp-head-actions">
          <StatusChip status={meta.status} />
          {editable ? (
            <>
              <p
                className={`lp-save ${save}`}
                role="status"
                aria-live="polite"
                data-testid="save-state"
              >
                {save === "saving" || save === "pending"
                  ? t("lp.save.saving")
                  : save === "error"
                    ? t("lp.save.error", { reason: saveErr })
                    : save === "conflict"
                      ? ""
                      : t("lp.save.saved")}
              </p>
              <button
                type="button"
                className="btn primary"
                aria-disabled={open > 0 || submitting || save === "conflict"}
                aria-describedby={blockedMsg ? "lp-blocked" : undefined}
                onClick={submit}
              >
                {submitting ? t("lp.submit.working") : t("lp.submit")}
              </button>
            </>
          ) : null}
        </div>
      </header>

      {blockedMsg && open > 0 ? (
        <p id="lp-blocked" className="lp-blocked" role="status" data-testid="submit-blocked">
          {tn(open, "lp.submit.blocked.one", "lp.submit.blocked.other")}
        </p>
      ) : null}
      {err ? <ErrorBox message={err} /> : null}
      {save === "conflict" ? (
        <div className="lp-conflict" role="alert" data-testid="conflict">
          <h4>{t("lp.conflict.title")}</h4>
          <p>{t("lp.conflict.body")}</p>
          <div className="row">
            <button type="button" className="btn primary" onClick={keepMine}>
              {t("lp.conflict.keep")}
            </button>
            <button type="button" className="btn" onClick={loadLatest}>
              {t("lp.conflict.load")}
            </button>
          </div>
        </div>
      ) : null}
      <LockedNote status={meta.status} />

      <div className="lp-ed">
        <div className="lp-main">
          <div className="lp-toolbar">
            <DeviceToggle device={device} onChange={setDevice} />
            <button
              type="button"
              className="pill"
              aria-pressed={actual}
              onClick={() => setActual(!actual)}
            >
              {actual ? t("lp.zoom.actual") : t("lp.zoom.fit")}
            </button>
          </div>
          {editable ? <p className="muted lp-hint">{t("lp.preview.hint")}</p> : null}
          <Frame device={device} actual={actual} label={t("lp.preview")}>
            <PagePreview
              page={{ ...initial, ...body, lang: pageLang, expiresAt: meta.expiresAt }}
              device={device}
              flagged={flagged}
              onSlot={
                editable
                  ? (sid, text) => edit({ slots: { ...draftRef.current.slots, [sid]: text } })
                  : undefined
              }
            />
          </Frame>
        </div>

        <aside className="lp-side" aria-label={t("lp.side")}>
          {editable ? (
            <>
              <div className="pills" role="group" aria-label={t("lp.side")}>
                {tabs.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className="pill"
                    aria-pressed={tab === k}
                    onClick={() => setTab(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === "refs" ? (
                <ReferencesPanel
                  draftId={id}
                  references={body.references}
                  lang={pageLang}
                  onChange={(references) => edit({ references })}
                />
              ) : null}
              {tab === "checks" ? (
                <>
                  <ChecksPanel
                    checks={checks}
                    running={checking}
                    onRun={() => void flush().then(() => runCheck())}
                    onFix={fix}
                    headingRef={checksHead}
                  />
                </>
              ) : null}
              {tab === "contact" ? (
                <ContactPanel contact={body.contact} onChange={(contact) => edit({ contact })} />
              ) : null}
            </>
          ) : null}
          {meta.status === "approved" ? (
            <PublishPanel
              id={id}
              onPublished={(r) =>
                setMeta({ status: "published", url: r.url, expiresAt: r.expiresAt })
              }
            />
          ) : null}
          {meta.status === "published" && meta.url ? (
            <PublishedPanel
              id={id}
              url={meta.url}
              expiresAt={meta.expiresAt}
              onUnpublished={() =>
                setMeta({ status: "unpublished", url: undefined, expiresAt: undefined })
              }
            />
          ) : null}
        </aside>
      </div>
    </>
  );
}
