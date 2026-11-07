export function validateImport(input: {
  source?: unknown;
  externalId?: unknown;
  version?: unknown;
  filename?: unknown;
  text?: unknown;
  url?: unknown;
}):
  | { ok: false; error: string }
  | { ok: true; source: "paste" | "file"; externalId: string; version: number; filename: string | null; text: string };
export function sha256Hex(text: string): Promise<string>;
export function storedBody(receipt: unknown, text: string): string;
export function readReceipt(body: string | null): {
  externalId?: string;
  source?: string;
  version?: number;
  contentSha256?: string;
  filename?: string | null;
  author?: string | null;
  principal?: string | null;
  tenant?: string | null;
  destination?: string | null;
  at?: string | null;
  outcome?: string | null;
  previous?: string | null;
  requestId?: string | null;
} | null;
export function visibleText(body: string | null): string;
export function matchReceipt(
  items: { body: string | null }[],
  key: { externalId: string; source: string; version: number; contentSha256: string },
): { same: unknown; conflict: unknown; previous: unknown };
