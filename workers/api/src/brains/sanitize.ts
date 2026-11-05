// Markdown from outside (an import) is untrusted. Raw HTML, script-bearing links, embedded images and
// event handlers never reach a page: the stored text is plain Markdown with http(s), mailto, relative
// and anchor links only.

const BLOCK = /<(script|style|iframe|object|embed|svg|math|template|noscript|form|textarea)\b[\s\S]*?<\/\1\s*>/gi;
const OPEN_BLOCK = /<(script|style|iframe|object|embed|svg|math|template|noscript|form|textarea)\b[^>]*>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<\/?[A-Za-z!?][^>\n]*>/g;
const IMAGE = /!\[[^\]\n]*\]\([^)\n]*\)/g;
const WIKI_EMBED = /!\[\[[^\]\n]*\]\]/g;
const REF_DEF = /^\s{0,3}\[[^\]\n]+\]:\s*\S+.*$/gm;
const LINK = /\[([^\]\n]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g;
const SAFE_TARGET = /^(?:https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|\/(?!\/)[^\s<>"']*|#[A-Za-z0-9_-]*)$/i;
const HANDLER = /\bon[a-z]{3,20}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

export function sanitizeMarkdown(md: string): string {
  let t = md.replaceAll("\u0000", "").replace(/\r\n?/g, "\n");
  // Look past entity and percent encoding tricks in link targets: only whitelisted targets survive.
  t = t.replace(COMMENT, "").replace(BLOCK, "").replace(OPEN_BLOCK, "");
  t = t.replace(WIKI_EMBED, "").replace(IMAGE, "").replace(REF_DEF, "");
  t = t.replace(LINK, (_m, text: string, target: string) =>
    SAFE_TARGET.test(target) ? `[${text}](${target})` : text,
  );
  t = t.replace(HANDLER, "").replace(TAG, "");
  // A bare scheme left in text (an autolink or a leftover) is made inert.
  t = t.replace(/\b(?:javascript|vbscript|data|file):/gi, (m) => `${m.slice(0, -1)} -`);
  // Citation and link tokens are ours: imported text cannot forge a citation or a cross-brain link.
  t = t.replace(/\{src:[^}]*\}/g, "").replace(/\[\[([^\]\n]*)\]\]/g, (_m, x: string) => x.split("|").pop() ?? "");
  return t.replace(/[ \t]+$/gm, "").replace(/\n{4,}/g, "\n\n\n").trim();
}
