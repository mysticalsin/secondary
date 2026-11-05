import { Fragment, type ReactNode } from "react";

const BOLD = /(\*\*[^*]+\*\*)/g;

function inline(text: string, key: string): ReactNode {
  return text
    .replace(/\{src:[^}]+\}/g, "")
    .replace(/\[\[(?:global:)?([^\]]+)\]\]/g, "$1")
    .split(BOLD)
    .map((part, i) =>
      /^\*\*[^*]+\*\*$/.test(part) ? (
        <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={`${key}-${i}`}>{part}</Fragment>
      ),
    );
}

/** The few Markdown shapes an answer uses: paragraphs, bullets and bold. Never HTML. */
export function AnswerMd({ md }: { md: string }) {
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = (i: number) => {
    if (list.length) out.push(<ul key={`u${i}`}>{list}</ul>);
    list = [];
  };
  md.split("\n").forEach((raw, i) => {
    const li = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (li) {
      list.push(<li key={`l${i}`}>{inline(li[1] as string, `l${i}`)}</li>);
      return;
    }
    flush(i);
    if (raw.trim()) out.push(<p key={`p${i}`}>{inline(raw.replace(/^#+\s*/, ""), `p${i}`)}</p>);
  });
  flush(-1);
  return <>{out}</>;
}
