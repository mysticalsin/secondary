const enc = new TextEncoder();

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const SOURCE_ID = /^[a-z][a-z0-9_]{5,39}$/;
export const TENANT_ID = /^[a-z0-9_]{3,64}$/;
export const NODE_ID = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;

/** Stable Secondary item id for a drive item. Hashed so it never carries a file name. */
export async function itemKey(sourceId: string, driveId: string, driveItemId: string) {
  return `src:${sourceId}:${(await sha256Hex(`${driveId}/${driveItemId}`)).slice(0, 24)}`;
}

/**
 * Opaque, stable per-user cache key: HMAC-SHA256 of the address under the shared connector secret
 * (M-03). An unkeyed hash of an email can be reversed by hashing a list of addresses; this cannot
 * without the secret. The email itself is never stored.
 */
export async function userKey(secret: string, email: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`acl-user-v2:${email.trim().toLowerCase()}`),
  );
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
