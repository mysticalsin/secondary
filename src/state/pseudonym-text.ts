/**
 * Replace `from` with `to`. The longer string is matched first at each position.
 * A second pass finds the name gone, or already covered by the longer pseudonym.
 *
 * Precondition: `to` is never a strict prefix of `from`. `pseudonymFor` returns
 * `pz_` plus an HMAC, which is longer than the id it replaces.
 * Matching is case-sensitive and has no word boundary, so a name inside a
 * longer word is replaced on purpose.
 */
export function replaceName(text: string, from: string, to: string): string {
  if (from === "" || from === to || !text.includes(from)) return text;
  const first = from.length >= to.length ? from : to;
  const second = first === from ? to : from;
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith(first, i)) {
      out += first === from ? to : first;
      i += first.length;
      continue;
    }
    if (second !== "" && text.startsWith(second, i)) {
      out += second === from ? to : second;
      i += second.length;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

function wholeWord(text: string, at: number, token: string): boolean {
  if (token === "" || !text.startsWith(token, at)) return false;
  const before = at === 0 || !/[A-Za-z0-9_]/.test(text[at - 1] ?? "");
  const end = at + token.length;
  const after = end >= text.length || !/[A-Za-z0-9_]/.test(text[end] ?? "");
  return before && after;
}

/** Replace a name of any length when it stands as its own word. A second pass finds it gone. */
export function boundedName(text: string, from: string, to: string): string {
  if (from === "" || from === to) return text;
  const first = from.length >= to.length ? from : to;
  const second = first === from ? to : from;
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (wholeWord(text, i, first)) {
      out += first === from ? to : first;
      i += first.length;
      continue;
    }
    if (second !== "" && wholeWord(text, i, second)) {
      out += second === from ? to : second;
      i += second.length;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}
