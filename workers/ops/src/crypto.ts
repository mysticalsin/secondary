// Snapshot encryption. AES-256-GCM, key derived from BACKUP_KEY with HKDF-SHA256.
// File layout: "SBK1" (4 bytes) | IV (12 bytes) | ciphertext+tag. The object key is bound in as
// additional authenticated data, so a snapshot copied under another name does not decrypt.

const MAGIC = new TextEncoder().encode("SBK1");
const IV_BYTES = 12;
export const MIN_BACKUP_KEY = 32;

const utf8 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

async function deriveKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", utf8(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: utf8("secondary-backup-v1"), info: utf8("aes-256-gcm") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBackup(
  secret: string,
  aad: string,
  plain: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (secret.length < MIN_BACKUP_KEY) throw new Error("BACKUP_KEY too short");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: utf8(aad) },
      await deriveKey(secret),
      plain,
    ),
  );
  const out = new Uint8Array(MAGIC.length + IV_BYTES + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(ct, MAGIC.length + IV_BYTES);
  return out as Uint8Array<ArrayBuffer>;
}

/** Tries each key in order (current, then previous). Returns null when none of them opens the snapshot. */
export async function decryptBackup(
  secrets: string[],
  aad: string,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (data.length < MAGIC.length + IV_BYTES + 16) return null;
  for (let i = 0; i < MAGIC.length; i++) if (data[i] !== MAGIC[i]) return null;
  const iv = data.slice(MAGIC.length, MAGIC.length + IV_BYTES);
  const ct = data.slice(MAGIC.length + IV_BYTES);
  for (const s of secrets) {
    if (s.length < MIN_BACKUP_KEY) continue;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: utf8(aad) },
        await deriveKey(s),
        ct,
      );
      return new Uint8Array(plain) as Uint8Array<ArrayBuffer>;
    } catch {
      // Wrong key: try the next one.
    }
  }
  return null;
}
