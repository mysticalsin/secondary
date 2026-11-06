import { FilePlus, FolderPlus, Import, Trash2 } from "lucide-react";
import { type FormEvent, lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../../api";
import { Modal } from "../../components/Modal";
import { Await, ErrorBox, Skeleton } from "../../components/ui";
import { useI18n } from "../../i18n";
import { InsightsTab } from "../../insights/InsightsTab";
import { buildContents } from "../../lib/contents";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { ux2 } from "../../uxv2/api";
import { BrainWhoKnows } from "../lens";
import { QUESTIONS_CHANGED } from "../waiting/events";
import { wikiApi } from "../wiki/api";
import { v3 } from "./api";
import { ContentsList, type Filters, NO_FILTER } from "./Contents";
import type { BrainHome } from "./types";

const BrainViews = lazy(() => import("../../agent/BrainViews"));

export function useBrainName(): (b: { id: string; name: string }) => string {
  const { t } = useI18n();
  return (b) => (b.id === "me" ? t("v4.personal") : b.name);
}

function NewPage({
  brain,
  collections,
  initialType,
  onClose,
}: {
  brain: string;
  collections: { type: string; label: string }[];
  initialType: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { say } = useApp();
  const [title, setTitle] = useState("");
  const [type, setType] = useState(initialType ?? collections[0]?.type ?? "");
  const [md, setMd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await v3.pushPage(brain, {
        title: title.trim(),
        markdown: md.trim() ? md : `# ${title.trim()}\n`,
        ...(type ? { type } : {}),
      });
      say(r.status === "published" ? t("v4.newpage.published") : t("v4.newpage.sent"));
      window.dispatchEvent(new Event(QUESTIONS_CHANGED));
      onClose();
    } catch (x) {
      setErr(x instanceof ApiError ? x.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t("v4.newpage")}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="newpage"
            className="btn primary"
            disabled={busy || !title.trim()}
          >
            {busy ? t("common.sending") : t("v4.newpage.send")}
          </button>
        </>
      }
    >
      <form id="newpage" className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="np-title">{t("v4.newpage.title")}</label>
          <input
            id="np-title"
            className="input"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="np-type">{t("v4.newpage.collection")}</label>
          <select
            id="np-type"
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {collections.map((c) => (
              <option key={c.type} value={c.type}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="np-md">{t("v4.newpage.body")}</label>
          <textarea
            id="np-md"
            className="textarea"
            value={md}
            onChange={(e) => setMd(e.target.value)}
          />
        </div>
        <p className="muted">{t("v4.newpage.note")}</p>
        {err ? (
          <div className="errorbox" role="alert">
            {err}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

function Head({ b }: { b: BrainHome }) {
  const { t, tn } = useI18n();
  const name = b.id === "me" ? t("v4.personal") : b.name;
  const personal = b.type === "personal";
  return (
    <header className="bhead">
      <div className="bhead-main">
        <h1>{name}</h1>
        <p className="muted">
          {personal
            ? t("v4.only.you")
            : `${tn(b.readers, "v4.readers.one", "v4.readers.other")}${b.manages ? ` · ${t("v4.you.manage")}` : ""}`}
        </p>
      </div>
      <div className="bhead-actions">
        <Link className="textlink" to={`/brains/${encodeURIComponent(b.id)}/activity`}>
          {t("v4.activity")}
        </Link>
        <Link className="textlink" to={`/brains/${encodeURIComponent(b.id)}/pulse`}>
          {t("v8p.link")}
        </Link>
        {!personal ? (
          <Link className="btn primary" to={`/brains/${encodeURIComponent(b.id)}/access`}>
            {t("v4.members.access")}
          </Link>
        ) : null}
      </div>
    </header>
  );
}

export function BrainPage() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  const TABS = ["contents", "insights", "myview"] as const;
  type Tab = (typeof TABS)[number];
  const tab: Tab = TABS.find((k) => k === sp.get("tab")) ?? "contents";
  const pickTab = (next: Tab) => setSp(next === "contents" ? {} : { tab: next }, { replace: true });
  const home = useApi(() => v3.brain(id), [id]);
  const idx = useApi(() => wikiApi.index(id), [id]);
  const waitingQ = useApi(() => ux2.questions({ brain: id }), [id]);
  const [filters, setFilters] = useState<Filters>(NO_FILTER);
  const [adding, setAdding] = useState<{ type: string | null } | null>(null);
  // `?new=1` (the command palette's "New page") opens the new page dialog and leaves the address clean.
  useEffect(() => {
    if (!sp.has("new")) return;
    setAdding({ type: null });
    const next = new URLSearchParams(sp);
    next.delete("new");
    setSp(next, { replace: true });
  }, [sp, setSp]);
  const tree = useMemo(
    () =>
      idx.data
        ? buildContents(
            idx.data,
            { sources: t("v4.sources"), reports: t("v4.session.reports") },
            new Set(home.data?.collections.filter((c) => c.expected).map((c) => c.type) ?? []),
          )
        : null,
    [idx.data, home.data, t],
  );
  const waiting = useMemo(
    () =>
      new Set((waitingQ.data ?? []).flatMap((q) => q.detail?.pages?.map((p) => p.pageId) ?? [])),
    [waitingQ.data],
  );
  const types = useMemo(
    () => (tree?.collections ?? []).map((c) => c.id.replace(/^collection:/, "")),
    [tree],
  );
  const typeOptions = useMemo(() => {
    const out: { type: string; label: string }[] = [];
    for (const c of tree?.collections ?? []) {
      if (!c.id.startsWith("collection:") || c.id === "collection:sources") continue;
      out.push({ type: c.id.slice("collection:".length), label: c.label });
    }
    if (tree?.loose.some((p) => p.type === "overview"))
      out.push({ type: "overview", label: t("v4.tag.overview") });
    return out;
  }, [tree, t]);
  void types;
  return (
    <div className={`page v4page${tab !== "contents" ? " wide" : ""}`}>
      <Await state={home} skeleton={2}>
        {(b) => (
          <>
            <Head b={b} />
            <div className="subactions">
              <Link className="btn ghost sm" to={`/brains/${encodeURIComponent(id)}/import`}>
                <Import size={15} aria-hidden /> {t("v4.import")}
              </Link>
              <Link className="btn ghost sm" to={`/brains/${encodeURIComponent(id)}/trash`}>
                <Trash2 size={15} aria-hidden /> {t("v4.trash")}
              </Link>
            </div>
            <div className="tabs" role="tablist" aria-label={t("v5.tabs")}>
              {TABS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  id={`bt-${k}`}
                  className="tab"
                  aria-selected={tab === k}
                  aria-controls={`bp-${k}`}
                  tabIndex={tab === k ? 0 : -1}
                  onClick={() => pickTab(k)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      e.preventDefault();
                      const at = TABS.indexOf(k);
                      const to = TABS[
                        (at + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length
                      ] as Tab;
                      pickTab(to);
                      document.getElementById(`bt-${to}`)?.focus();
                    }
                  }}
                >
                  {k === "myview" ? t("v6.tab.myview") : t(`v5.tab.${k}` as "v5.tab.contents")}
                </button>
              ))}
            </div>
            {tab === "contents" && b.type !== "personal" ? (
              <div className="bwk8">
                <BrainWhoKnows brain={id} collections={typeOptions} />
              </div>
            ) : null}
            {tab === "insights" ? (
              <div role="tabpanel" id="bp-insights" aria-labelledby="bt-insights">
                <InsightsTab brainId={id} />
              </div>
            ) : null}
            {tab === "myview" ? (
              <div role="tabpanel" id="bp-myview" aria-labelledby="bt-myview">
                <Suspense fallback={<Skeleton n={2} />}>
                  <BrainViews brainId={id} />
                </Suspense>
              </div>
            ) : null}
            <section
              aria-labelledby="contents-h"
              className="contents-sec"
              role="tabpanel"
              id="bp-contents"
              hidden={tab !== "contents"}
            >
              <div className="sec-head">
                <div>
                  <h2 id="contents-h">{t("v4.contents")}</h2>
                  <p className="muted">{t("v4.contents.lead")}</p>
                </div>
                <div className="row">
                  {b.manages ? (
                    <Link className="btn soft sm" to={`/brains/${encodeURIComponent(id)}/coach`}>
                      <FolderPlus size={15} aria-hidden /> {t("v4.newcollection")}
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className="btn primary sm"
                    onClick={() => setAdding({ type: null })}
                  >
                    <FilePlus size={15} aria-hidden /> {t("v4.newpage")}
                  </button>
                </div>
              </div>
              <div className="filters4" role="group" aria-label={t("v4.filters")}>
                <input
                  className="input"
                  type="search"
                  value={filters.term}
                  onChange={(e) => setFilters({ ...filters, term: e.target.value })}
                  aria-label={t("v4.filter.term")}
                  placeholder={t("v4.filter.term")}
                />
                <select
                  className="select"
                  aria-label={t("v4.filter.type")}
                  value={filters.type}
                  onChange={(e) => setFilters({ ...filters, type: e.target.value })}
                >
                  <option value="">{t("v4.filter.type.all")}</option>
                  {typeOptions.map((o) => (
                    <option key={o.type} value={o.type}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  className="select"
                  aria-label={t("v4.filter.status")}
                  value={filters.status}
                  onChange={(e) =>
                    setFilters({ ...filters, status: e.target.value as Filters["status"] })
                  }
                >
                  <option value="">{t("v4.filter.status.any")}</option>
                  <option value="published">{t("v4.status.published")}</option>
                  <option value="draft">{t("v4.status.draft")}</option>
                </select>
                <select
                  className="select"
                  aria-label={t("v4.filter.review")}
                  value={filters.review}
                  onChange={(e) =>
                    setFilters({ ...filters, review: e.target.value as Filters["review"] })
                  }
                >
                  <option value="">{t("v4.filter.review.any")}</option>
                  <option value="waiting">{t("v4.review.waiting")}</option>
                  <option value="none">{t("v4.review.none")}</option>
                </select>
              </div>
              {idx.loading && !tree ? <Skeleton n={4} /> : null}
              {idx.error ? <ErrorBox message={idx.error} onRetry={idx.reload} /> : null}
              {tree ? (
                <ContentsList
                  brain={id}
                  tree={tree}
                  filters={filters}
                  waiting={waiting}
                  onAdd={(type) => setAdding({ type })}
                />
              ) : null}
            </section>
            {adding ? (
              <NewPage
                brain={id}
                collections={typeOptions}
                initialType={adding.type}
                onClose={() => {
                  setAdding(null);
                  waitingQ.reload();
                }}
              />
            ) : null}
          </>
        )}
      </Await>
    </div>
  );
}
