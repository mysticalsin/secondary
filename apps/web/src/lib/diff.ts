// Line diff by longest common subsequence. Small inputs only (notes and candidates are capped at
// 8,000 characters), so the plain O(n*m) table is fine and easy to read.

export interface DiffLine {
  type: "add" | "del" | "same";
  text: string;
}

const MAX_LINES = 600;

export function lineDiff(before: string | null | undefined, after: string): DiffLine[] {
  const a = before === null || before === undefined ? [] : before.split("\n");
  const b = after.split("\n");
  // A pathological input degrades to "all removed, all added" instead of a huge table.
  if (a.length > MAX_LINES || b.length > MAX_LINES)
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  const n = a.length;
  const m = b.length;
  // lcs[i][j] is the length of the common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i] as number[];
    const next = lcs[i + 1] as number[];
    for (let j = m - 1; j >= 0; j--)
      row[j] =
        a[i] === b[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] as string });
      i++;
      j++;
    } else if (((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number)) {
      out.push({ type: "del", text: a[i++] as string });
    } else {
      out.push({ type: "add", text: b[j++] as string });
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] as string });
  while (j < m) out.push({ type: "add", text: b[j++] as string });
  return out;
}

export const diffStats = (d: DiffLine[]) => ({
  added: d.filter((x) => x.type === "add").length,
  removed: d.filter((x) => x.type === "del").length,
});
