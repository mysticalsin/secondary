// Text extraction. Per PRD 4.2 only UTF-8 text and Markdown are read. Office, PDF, images and every
// other type stay source links: metadata only, no content is downloaded or stored.

export const EXTRACTOR_VERSION = "connector-text-1";
export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_BODY_CHARS = 32_000;

const TEXT_EXT = new Set(["md", "markdown", "txt"]);
const TEXT_MIME = new Set(["text/plain", "text/markdown"]);

const extOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};

/** True when the file may be downloaded and read as text. */
export function isTextCandidate(name: string, mime: string | null, size: number): boolean {
  if (size > MAX_TEXT_BYTES) return false;
  const ext = extOf(name);
  if (ext) return TEXT_EXT.has(ext);
  return mime !== null && TEXT_MIME.has(mime.toLowerCase());
}

/** Strict UTF-8 decode. Anything that is not clean text (bad bytes, NUL) yields null. */
export function decodeText(bytes: Uint8Array): string | null {
  let s: string;
  try {
    s = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  if (s.includes("\u0000")) return null;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.length > MAX_BODY_CHARS ? s.slice(0, MAX_BODY_CHARS) : s;
}
