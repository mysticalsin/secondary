import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n";
import type { WikiCitation, WikiPage } from "./types";

const TOKEN = /(\{src:[^}]+\}|\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)\s]+\))/g;
/** Images come from the brain's own files, a secure address, or an inline image. Nothing else loads. */
const IMG_OK = /^(https:\/\/|\/v1\/|data:image\/)/;

/** Wiki Markdown is plain: headings, bullets, paragraphs, citations and page links. Nothing is HTML. */
export function Markdown({
  md,
  citations,
  links,
  onLink,
}: {
  md: string;
  citations: Record<string, WikiCitation>;
  links: WikiPage["links"];
  onLink: (id: string) => void;
}) {
  const { t } = useI18n();
  const order = [...new Set([...md.matchAll(/\{src:([^}]+)\}/g)].map((m) => m[1] as string))];
  const linkOf = new Map(links.map((l) => [l.id, l]));

  const inline = (text: string, key: string): ReactNode =>
    text.split(TOKEN).map((part, i) => {
      const k = `${key}-${i}`;
      const src = /^\{src:(.+)\}$/.exec(part)?.[1];
      if (src) {
        const n = order.indexOf(src) + 1;
        const c = citations[src];
        return (
          <a
            key={k}
            className="cite"
            href={`#wiki-src-${n}`}
            aria-label={t("wiki.cite", { n, title: c?.title ?? src })}
          >
            {n}
          </a>
        );
      }
      const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(part);
      if (img) {
        const url = img[2] as string;
        return IMG_OK.test(url) ? (
          <img key={k} className="wiki-img" src={url} alt={img[1] ?? ""} loading="lazy" />
        ) : null;
      }
      const ref = /^\[\[(.+)\]\]$/.exec(part)?.[1];
      if (ref) {
        const l = linkOf.get(ref);
        if (ref.startsWith("global:"))
          return (
            <span key={k} className="chip t-open">
              {t("wiki.link.global", { id: ref.slice(7) })}
            </span>
          );
        if (l?.broken)
          return (
            <span key={k} className="chip t-risk">
              {t("wiki.link.broken", { id: ref })}
            </span>
          );
        return (
          <button key={k} type="button" className="linkbtn" onClick={() => onLink(ref)}>
            {l?.title ?? ref}
          </button>
        );
      }
      return <Fragment key={k}>{part}</Fragment>;
    });

  const lines = md.split("\n");
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = (i: number) => {
    if (list.length) out.push(<ul key={`ul-${i}`}>{list}</ul>);
    list = [];
  };
  lines.forEach((raw, i) => {
    const key = `l${i}`;
    const h = /^(#{1,3})\s+(.*)$/.exec(raw);
    const li = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (li) {
      list.push(<li key={key}>{inline(li[1] as string, key)}</li>);
      return;
    }
    flush(i);
    if (h) {
      const level = (h[1] as string).length;
      const body = inline(h[2] as string, key);
      // The page title is the page's own heading. Inside the wiki, markdown headings start one level lower.
      out.push(
        level === 1 ? (
          <h4 key={key}>{body}</h4>
        ) : level === 2 ? (
          <h5 key={key}>{body}</h5>
        ) : (
          <h6 key={key}>{body}</h6>
        ),
      );
    } else if (raw.trim()) out.push(<p key={key}>{inline(raw, key)}</p>);
  });
  flush(lines.length);

  return (
    <div className="wiki-md">
      {out}
      {order.length ? (
        <ol className="wiki-sources" aria-label={t("wiki.page.sources")}>
          {order.map((id, n) => {
            const c = citations[id];
            return (
              <li key={id} id={`wiki-src-${n + 1}`}>
                {c?.kind === "source" ? (
                  <Link to={`/sources/${encodeURIComponent(id)}`}>{c.title}</Link>
                ) : (
                  (c?.title ?? id)
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
