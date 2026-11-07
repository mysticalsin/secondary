/**
 * NEW RECONSTRUCTION import policy. Not a recovered route.
 * Text is untrusted data. Nothing here fetches a URL.
 * The stored body must fit the recovered personal item limit of 8000 characters.
 */

export const MAX_TEXT = 7000;
export const MAX_FILE_BYTES = 8000;
export const ALLOWED_EXTENSIONS = [".txt", ".md"];

const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/**
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {string} filename
 * @returns {string}
 */
function extensionOf(filename) {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index).toLowerCase();
}

/**
 * @param {unknown} input
 * @returns {{ ok: false, error: string } | { ok: true, source: "paste" | "file", externalId: string, version: number, filename: string | null, text: string }}
 */
export function validateImport(input) {
  if (!isRecord(input)) return { ok: false, error: "invalid_import" };
  if (input.url !== undefined) return { ok: false, error: "url_import_refused" };
  const source = input.source;
  if (source !== "paste" && source !== "file") return { ok: false, error: "invalid_source" };
  const externalId = input.externalId;
  if (typeof externalId !== "string" || !EXTERNAL_ID.test(externalId))
    return { ok: false, error: "invalid_external_id" };
  const version = input.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 1000)
    return { ok: false, error: "invalid_version" };
  let filename = null;
  if (source === "file") {
    filename = input.filename;
    if (typeof filename !== "string" || !FILENAME.test(filename)) return { ok: false, error: "invalid_filename" };
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\"))
      return { ok: false, error: "invalid_filename" };
    if (!ALLOWED_EXTENSIONS.includes(extensionOf(filename))) return { ok: false, error: "unsupported_type" };
  }
  const text = input.text;
  if (typeof text !== "string") return { ok: false, error: "invalid_text" };
  if (text.includes("\u0000")) return { ok: false, error: "unsupported_content" };
  if (text.startsWith("#!") || text.startsWith("MZ") || text.includes("\u007fELF"))
    return { ok: false, error: "unsupported_content" };
  if (/<script/i.test(text) || /javascript:/i.test(text)) return { ok: false, error: "unsupported_content" };
  if (text.length === 0 || text.length > MAX_TEXT) return { ok: false, error: "invalid_text" };
  if (source === "file" && new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES)
    return { ok: false, error: "file_too_large" };
  return { ok: true, source, externalId, version, filename, text };
}

/**
 * @param {unknown} receipt
 * @returns {string}
 */
export function receiptLine(receipt) {
  return JSON.stringify(receipt);
}

/**
 * @param {unknown} receipt
 * @param {string} text
 * @returns {string}
 */
export function storedBody(receipt, text) {
  return `${receiptLine(receipt)}\n\n${text}`;
}

/**
 * @typedef {{
 *   import?: number,
 *   externalId?: string,
 *   source?: string,
 *   version?: number,
 *   contentSha256?: string,
 *   filename?: string | null,
 *   author?: string | null,
 *   principal?: string | null,
 *   tenant?: string | null,
 *   destination?: string | null,
 *   at?: string | null,
 *   outcome?: string | null,
 *   previous?: string | null,
 *   requestId?: string | null
 * }} ImportReceipt
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is ImportReceipt}
 */
function isReceipt(value) {
  return isRecord(value) && value.import === 1;
}

/**
 * @param {string | null} body
 * @returns {ImportReceipt | null}
 */
export function readReceipt(body) {
  const line = String(body ?? "").split("\n", 1)[0];
  try {
    const value = JSON.parse(line);
    if (isReceipt(value)) return value;
  } catch {
    return null;
  }
  return null;
}

/**
 * @param {string | null} body
 * @returns {string}
 */
export function visibleText(body) {
  const raw = String(body ?? "");
  if (!readReceipt(raw)) return raw;
  const index = raw.indexOf("\n\n");
  return index === -1 ? "" : raw.slice(index + 2);
}

/**
 * @param {{ body: string | null }[]} items
 * @param {{ externalId: string, source: string, version: number, contentSha256: string }} key
 * @returns {{ same: { body: string | null } | null, conflict: { body: string | null } | null, previous: { body: string | null } | null }}
 */
export function matchReceipt(items, key) {
  let same = null;
  let conflict = null;
  let previous = null;
  for (const item of items) {
    const receipt = readReceipt(item.body);
    if (!receipt || receipt.externalId !== key.externalId || receipt.source !== key.source) continue;
    if (receipt.version === key.version && receipt.contentSha256 === key.contentSha256) same = item;
    if (receipt.version === key.version && receipt.contentSha256 !== key.contentSha256) conflict = item;
    const earlier = previous === null ? null : readReceipt(previous.body);
    if (previous === null || (earlier !== null && typeof receipt.version === "number" && typeof earlier.version === "number" && receipt.version > earlier.version)) previous = item;
  }
  return { same, conflict, previous };
}
