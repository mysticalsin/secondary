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
