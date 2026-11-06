import { Bookmark, BookmarkPlus, ExternalLink, Eye, Search, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ErrorBox, Skeleton } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { pageLink } from "../../lib/links";
import { ago } from "../../lib/time";
import { useApi } from "../../useApi";
import { EmptyArt } from "../lens/art";
import { roleFill } from "../lens/roles";
import { searchApi } from "./api";
import type { FacetKey, FacetRow, Hit, Picked, Saved } from "./types";

const FACETS: { key: FacetKey; label: Key; param: keyof Picked }[] = [
  { key: "brain", label: "v8s.facet.brain", param: "brain" },
  { key: "type", label: "v8s.facet.type", param: "type" },
  { key: "fresh", label: "v8s.facet.fresh", param: "age" },
  { key: "status", label: "v8s.facet.status", param: "status" },
  { key: "role", label: "v8s.facet.role", param: "role" },
];

const list = (v: string | null): string[] => (v ? v.split(",").filter(Boolean) : []);

function Facet({
  f,
  rows,
  picked,
  onToggle,
}: {
  f: (typeof FACETS)[number];
  rows: FacetRow[];
  picked: string[];
  onToggle: (id: string) => void;
}) {
  const { t, tn } = useI18n();
  const name = (r: FacetRow): string =>
    f.key === "fresh"
      ? t(`v8s.fresh.${r.id}` as "v8s.fresh.lt30")
      : f.key === "status"
        ? t(`v8s.status.${r.id}` as "v8s.status.verified")
        : f.key === "role"
          ? t(`v8l.role.${r.id}` as "v8l.role.reader")
          : f.key === "brain" && r.id === "me"
            ? t("v4.personal")
            : r.label;
  // A picked value stays in the list even when it now matches nothing, so it can be unpicked.
  const shown = rows.filter((r) => r.n > 0 || picked.includes(r.id));
  if (!shown.length) return null;
  return (
    <fieldset className="fc8">
      <legend>{t(f.label)}</legend>
      <ul>
        {shown.map((r) => (
          <li key={r.id}>
            <label>
              <input
                type="checkbox"
                checked={picked.includes(r.id)}
                onChange={() => onToggle(r.id)}
              />
              <span className="fc8-n">{name(r)}</span>
              <span className="fc8-c" aria-hidden>
                {r.n}
              </span>
              <span className="sr-only">{tn(r.n, "v8s.hits.one", "v8s.hits.other")}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function Preview({ h }: { h: Hit }) {
  const { t, tn } = useI18n();
  return (
    <div className="pv8" data-testid="search-preview">
      <p className="pv8-meta">
        {h.brainId === "me" ? t("v4.personal") : h.brainName} · {h.collection} ·{" "}
        {t(`v8s.status.${h.status}` as "v8s.status.verified")}
      </p>
      <h2>{h.title}</h2>
      {h.summary ? <p className="pv8-sum">{h.summary}</p> : null}
      {h.lines.length ? (
        <ul className="pv8-lines">
          {h.lines.map((l) => (
            <li key={l.text}>
              <p>{l.text}</p>
              {l.citations.length ? (
                <p className="pv8-src">
                  {t("v8s.from")} {l.citations.map((c) => c.title).join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t("v8s.nolines")}</p>
      )}
      {h.restricted ? (
        <p className="muted">{tn(h.restricted, "v8s.restricted.one", "v8s.restricted.other")}</p>
      ) : null}
      <p className="pv8-foot">
        <span className="pv8-role">
          <span className="pv8-dot" aria-hidden style={{ background: roleFill(h.role) }} />
          {t("v8s.lastby", { role: t(`v8l.role.${h.role}` as "v8l.role.reader") })}
        </span>
        <span>{t("v8s.updated", { when: ago(h.updatedAt) })}</span>
      </p>
      <p>
        <Link className="btn primary sm" to={pageLink(h.brainId, h.id)}>
          <ExternalLink size={15} aria-hidden /> {t("v8s.open")}
        </Link>
      </p>
    </div>
  );
}

function SavedPanel({
  q,
  saved,
  reload,
  onPick,
}: {
  q: string;
  saved: Saved[];
  reload: () => void;
  onPick: (s: Saved) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const can = q.trim().length > 0 && !saved.some((s) => s.q === q.trim());
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!can || !name.trim()) return;
    setBusy(true);
    try {
      await searchApi.save(name.trim(), q.trim());
      setName("");
      reload();
    } finally {
      setBusy(false);
    }
  };
  const del = async (s: Saved) => {
    await searchApi.remove(s.id);
    reload();
  };
  return (
    <section className="sv8" aria-labelledby="sv8-h" data-testid="saved-searches">
      <h2 id="sv8-h">{t("v8s.saved")}</h2>
      {saved.length ? (
        <ul>
          {saved.map((s) => (
            <li key={s.id}>
              <button type="button" className="sv8-pick" onClick={() => onPick(s)}>
                <Bookmark size={14} aria-hidden /> <span>{s.name}</span>
                <span className="sv8-q">{s.q}</span>
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={t("v8s.saved.remove", { name: s.name })}
                onClick={() => del(s)}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="sv8-empty">
          <EmptyArt kind="saved" />
          <p className="muted">{t("v8s.saved.none")}</p>
        </div>
      )}
      {can ? (
        <form className="sv8-add" onSubmit={add}>
          <label className="sr-only" htmlFor="sv8-name">
            {t("v8s.saved.name")}
          </label>
          <input
            id="sv8-name"
            className="input"
            value={name}
            maxLength={60}
            placeholder={t("v8s.saved.name")}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn soft sm" disabled={busy || !name.trim()}>
            <BookmarkPlus size={15} aria-hidden /> {t("v8s.saved.add")}
          </button>
        </form>
      ) : null}
    </section>
  );
}

/** True below the width where the preview moves under the selected result. */
function useNarrow(): boolean {
  const q = "(max-width: 900px)";
  const [n, setN] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setN(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return n;
}

/** Search across the brains the person can read: operators, facets, a preview pane and saved searches. */
export function SearchPage() {
  const [sp, setSp] = useSearchParams();
  const { t, tn } = useI18n();
  const term = sp.get("q") ?? "";
  const fromUrl = useMemo<Picked>(
    () => ({
      brain: list(sp.get("brain")),
      type: list(sp.get("type")),
      age: list(sp.get("age")),
      status: list(sp.get("status")),
      role: list(sp.get("role")),
    }),
    [sp],
  );
  // A box answers the moment it is clicked; the address catches up after.
  const [picked, setPicked] = useState<Picked>(fromUrl);
  useEffect(() => setPicked(fromUrl), [fromUrl]);
  const [draft, setDraft] = useState(term);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(term), [term]);
  const key = sp.toString();
  const res = useApi(() => searchApi.pages(term, picked), [key]);
  const saved = useApi(() => searchApi.saved(), []);
  const [sel, setSel] = useState<string | null>(null);
  const narrow = useNarrow();
  const [showFilters, setShowFilters] = useState(false);
  const data = res.data;
  const results = data?.results ?? [];
  const selected = results.find((h) => `${h.brainId}:${h.id}` === sel) ?? results[0];
  useEffect(() => setSel(null), [key]);

  const put = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    setSp(p, { replace: false });
  };
  const current = (): Record<string, string> => {
    const o: Record<string, string> = {};
    for (const [k, v] of sp.entries()) o[k] = v;
    return o;
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    put({ ...current(), q: draft.trim() });
  };
  const toggle = (param: keyof Picked, id: string) => {
    const cur = new Set(picked[param] ?? []);
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    setPicked({ ...picked, [param]: [...cur] });
    put({ ...current(), [param]: [...cur].join(",") });
  };
  const pickedCount = Object.values(picked).reduce((n, v) => n + (v?.length ?? 0), 0);
  const clearFilters = () => put({ q: term });
  const addOp = (op: string) => {
    setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}${op}`);
    input.current?.focus();
  };

  return (
    <div className="page v4page wide search8" data-testid="search-page">
      <h1 className="ptitle">{term ? t("v4.search.results", { q: term }) : t("v8s.title")}</h1>
      <form className="searchbar" role="search" onSubmit={submit}>
        <div className="sfield big">
          <Search size={16} aria-hidden />
          <input
            ref={input}
            type="search"
            value={draft}
            maxLength={300}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={t("v4.search.label")}
            aria-describedby="s8-hint"
            placeholder={t("v8s.ph")}
          />
        </div>
        <button type="submit" className="btn soft">
          {t("v4.search.go")}
        </button>
      </form>
      <p id="s8-hint" className="s8-hint">
        {t("v8s.hint")}{" "}
        {["brain:", "type:", "fresh:<30d"].map((op) => (
          <button key={op} type="button" className="s8-op" onClick={() => addOp(op)}>
            {op}
          </button>
        ))}
      </p>
      {data?.parsed.ignored.length ? (
        <p className="s8-note" role="status">
          {t("v8s.ignored", { ops: data.parsed.ignored.join(" ") })}
        </p>
      ) : null}

      <div className="s8-grid">
        <aside className="s8-side" aria-label={t("v8s.filters")}>
          {/* On a phone the filters fold away under the results; on a wide screen they stay open. */}
          <details
            className="s8-det"
            open={!narrow || showFilters}
            onToggle={(e) => narrow && setShowFilters(e.currentTarget.open)}
          >
            <summary>
              {t("v8s.filters")}
              {pickedCount ? ` (${pickedCount})` : ""}
            </summary>
            {data ? (
              <div className="s8-facets">
                <div className="s8-fhead">
                  <h2>{t("v8s.filters")}</h2>
                  {pickedCount ? (
                    <button type="button" className="textlink" onClick={clearFilters}>
                      {t("common.clear")}
                    </button>
                  ) : null}
                </div>
                {FACETS.map((f) => (
                  <Facet
                    key={f.key}
                    f={f}
                    rows={data.facets[f.key] ?? []}
                    picked={picked[f.param] ?? []}
                    onToggle={(id) => toggle(f.param, id)}
                  />
                ))}
              </div>
            ) : null}
            <SavedPanel
              q={term}
              saved={saved.data?.saved ?? []}
              reload={saved.reload}
              onPick={(s) => put({ q: s.q })}
            />
          </details>
        </aside>

        <section className="s8-results" aria-label={t("v8s.results")}>
          {res.loading && !data ? <Skeleton n={4} /> : null}
          {res.error ? <ErrorBox message={res.error} onRetry={res.reload} /> : null}
          {data && !results.length ? (
            <div className="lens-empty s8-empty" data-testid="search-empty">
              <EmptyArt kind="search" />
              <p>
                <b>{term || pickedCount ? t("v4.search.none") : t("v4.search.empty")}</b>
              </p>
              <p>{term || pickedCount ? t("v8s.none.lead") : t("v8s.empty.lead")}</p>
              {pickedCount ? (
                <button type="button" className="btn soft sm" onClick={clearFilters}>
                  {t("v8s.clear.filters")}
                </button>
              ) : null}
            </div>
          ) : null}
          {results.length ? (
            <>
              <p className="muted s8-count" role="status">
                {tn(data?.total ?? 0, "v4.search.n.one", "v4.search.n.other")}
              </p>
              <ul className="s8-list">
                {results.map((h) => {
                  const k = `${h.brainId}:${h.id}`;
                  const on = selected && `${selected.brainId}:${selected.id}` === k;
                  return (
                    <li key={k} className={on ? "on" : ""} onFocus={() => setSel(k)}>
                      <div className="s8-row">
                        <Link className="s8-hit" to={pageLink(h.brainId, h.id)}>
                          <span className="s8-t">{h.title}</span>
                          <span className="s8-m">
                            {h.brainId === "me" ? t("v4.personal") : h.brainName} · {h.collection} ·{" "}
                            {t("v8s.updated", { when: ago(h.updatedAt) })}
                          </span>
                          {h.summary ? <span className="s8-s">{h.summary}</span> : null}
                        </Link>
                        <button
                          type="button"
                          className="s8-pvbtn"
                          aria-pressed={!!on}
                          aria-label={t("v8s.preview.of", { title: h.title })}
                          onClick={() => setSel(k)}
                        >
                          <Eye size={16} aria-hidden />
                        </button>
                      </div>
                      {on && narrow ? (
                        <div className="s8-inline">
                          <Preview h={h} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </section>

        {narrow ? null : (
          <aside className="s8-prev" aria-label={t("v8s.preview")}>
            {selected ? (
              <Preview h={selected} />
            ) : (
              <div className="lens-empty">
                <EmptyArt kind="palette" />
                <p>{t("v8s.preview.none")}</p>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
