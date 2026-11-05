// A guarded zip reader for imports. It reads the central directory, supports stored and deflate
// entries, and refuses what could hurt: too many entries, huge declared or real sizes, compression
// ratios above 100:1, zip64, encryption and truncated archives. It never touches a file system, so a
// path is only ever a label; unsafe ones are reported and skipped by the caller.

export interface UnzipLimits {
  maxBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxRatio: number;
}

export const IMPORT_LIMITS: UnzipLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxEntries: 200,
  maxEntryBytes: 256 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxRatio: 100,
};

export type ZipEntry = { path: string; bytes: Uint8Array } | { path: string; skipped: string };

export class ZipError extends Error {
  code: "too_large" | "invalid_archive";
  reason: string;
  constructor(code: "too_large" | "invalid_archive", reason: string) {
    super(reason);
    this.code = code;
    this.reason = reason;
  }
}

const bad = (reason: string): never => {
  throw new ZipError("invalid_archive", reason);
};
const big = (reason: string): never => {
  throw new ZipError("too_large", reason);
};

/** Inflate with a hard cap on the output: the stream is cancelled the moment it passes `limit`. */
async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const feed = writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close());
  feed.catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > limit) {
        await reader.cancel();
        return big("an entry unpacks larger than allowed");
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ZipError) throw e;
    return bad("a compressed entry is corrupt");
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function unzipGuarded(
  bytes: Uint8Array,
  limits: UnzipLimits = IMPORT_LIMITS,
): Promise<ZipEntry[]> {
  if (bytes.length > limits.maxBytes) big("the archive is larger than allowed");
  if (bytes.length < 22) bad("not a zip archive");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  const floor = Math.max(0, bytes.length - 22 - 65_535);
  while (end >= floor && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < floor) bad("no end of central directory");
  const count = v.getUint16(end + 10, true);
  const cdSize = v.getUint32(end + 12, true);
  let at = v.getUint32(end + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || at === 0xffffffff) bad("zip64 is not supported");
  if (count > limits.maxEntries) big("too many entries");
  if (at + cdSize > end) bad("the central directory is out of range");

  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || v.getUint32(at, true) !== 0x02014b50) bad("bad central header");
    const flags = v.getUint16(at + 8, true);
    const method = v.getUint16(at + 10, true);
    const csize = v.getUint32(at + 20, true);
    const usize = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    if (at + 46 + nameLen > bytes.length) bad("bad entry name");
    const path = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/")) continue; // a directory
    if (flags & 1) bad("encrypted entries are not supported");
    if (csize === 0xffffffff || usize === 0xffffffff) bad("zip64 is not supported");
    if (usize > limits.maxEntryBytes) {
      out.push({ path, skipped: "too_large" });
      continue;
    }
    // The declared sizes are only a hint: the real output is capped below.
    total += usize;
    if (total > limits.maxTotalBytes) big("the archive unpacks larger than allowed");
    if (csize > 0 && usize / csize > limits.maxRatio) big("the compression ratio is too high");
    if (local + 30 > bytes.length || v.getUint32(local, true) !== 0x04034b50)
      bad("bad local header");
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (start + csize > bytes.length) bad("an entry runs past the end of the archive");
    const raw = bytes.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw;
    else if (method === 8) data = await inflate(raw, limits.maxEntryBytes);
    else {
      out.push({ path, skipped: "unsupported_method" });
      continue;
    }
    if (data.length > limits.maxEntryBytes) {
      out.push({ path, skipped: "too_large" });
      continue;
    }
    if (csize > 0 && data.length / Math.max(csize, 1) > limits.maxRatio * 2)
      big("the compression ratio is too high");
    out.push({ path, bytes: data });
  }
  return out;
}

/** A path is a label only, but anything that could climb out of a folder is refused by name. */
export function isUnsafePath(path: string): boolean {
  return (
    path.length === 0 ||
    path.length > 300 ||
    path.includes("\u0000") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((seg) => seg === ".." || seg === ".")
  );
}
