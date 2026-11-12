/** Replace `from` with `to`, leaving a span that is already `to`. */
export function replaceName(text: string, from: string, to: string): string {
  if (from === "" || from === to || !text.includes(from)) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (to !== "" && text.startsWith(to, i)) {
      out += to;
      i += to.length;
      continue;
    }
    if (text.startsWith(from, i)) {
      out += to;
      i += from.length;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}
