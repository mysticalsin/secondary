import { Link, useSearchParams } from "react-router-dom";
import { Empty, Skeleton } from "../../components/ui";
import { useI18n } from "../../i18n";
import { pageLink } from "../../lib/links";
import { useApi } from "../../useApi";
import { v3 } from "../brains/api";
import { wikiApi } from "../wiki/api";
import type { WikiSearchHit } from "../wiki/types";

interface Hit extends WikiSearchHit {
  brainName: string;
}

/** Search across the brains the person can read. Each brain answers for itself, so nothing crosses a brain they cannot open. */
export function SearchPage() {
  const [sp] = useSearchParams();
  const term = (sp.get("q") ?? "").trim();
  const { t, tn } = useI18n();
  const res = useApi(async () => {
    if (!term) return [] as Hit[];
    const nav = await v3.nav();
    const brains = nav.items.flatMap((i) => (i.children?.length ? i.children : [i]));
    const out = await Promise.allSettled(
      brains.map(async (b) => {
        const r = await wikiApi.search(b.id, term);
        return r.results.map<Hit>((h) => ({
          ...h,
          ws: b.id,
          brainName: b.id === "me" ? t("v4.personal") : b.name,
        }));
      }),
    );
    return out.flatMap((o) => (o.status === "fulfilled" ? o.value : []));
  }, [term]);
  return (
    <div className="page v4page narrow">
      <h1 className="ptitle">{t("v4.search.results", { q: term })}</h1>
      {res.loading && !res.data ? <Skeleton n={3} /> : null}
      {res.data && !res.data.length ? (
        <Empty title={term ? t("v4.search.none") : t("v4.search.empty")}>
          {term ? t("v4.search.none.lead") : t("v4.search.empty.lead")}
        </Empty>
      ) : null}
      {res.data?.length ? (
        <>
          <p className="muted">{tn(res.data.length, "v4.search.n.one", "v4.search.n.other")}</p>
          <ul className="rows hits">
            {res.data.map((h) => (
              <li key={`${h.ws}:${h.pageId}`} className="hit">
                <Link to={pageLink(h.ws, h.pageId)}>{h.title}</Link>
                <span className="tag">{h.brainName}</span>
                <p className="muted clamp">{h.summary}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
