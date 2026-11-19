import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type GuardMode = "dry-run" | "deploy";
export type GuardResult = { ok: true } | { ok: false; reason: string };

const MIGRATION_KEYS = ["deleted_classes", "renamed_classes", "transferred_classes", "new_classes"] as const;

export function stripJsonc(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

function migrationOk(config: Record<string, unknown>): boolean {
  const migrations = config.migrations;
  if (!Array.isArray(migrations) || migrations.length !== 1) return false;
  const entry = migrations[0] as Record<string, unknown>;
  if (entry.tag !== "v3") return false;
  if (!Array.isArray(entry.new_sqlite_classes)) return false;
  if (entry.new_sqlite_classes.length !== 2) return false;
  if (entry.new_sqlite_classes[0] !== "TenantPolicy" || entry.new_sqlite_classes[1] !== "Workspace") return false;
  return MIGRATION_KEYS.every((key) => !Object.hasOwn(entry, key));
}

function assetPath(assets: string, rel: string): string {
  return join(assets, ...rel.split("/"));
}

function listAssetFiles(dir: string, prefix: string): string[] | null {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) return null;
    if (entry.isDirectory()) {
      const nested = listAssetFiles(join(dir, entry.name), rel);
      if (nested === null) return null;
      out.push(...nested);
      continue;
    }
    if (!entry.isFile()) return null;
    out.push(rel);
  }
  return out;
}

function checkManifest(assets: string): GuardResult {
  const manifestPath = join(assets, "MANIFEST.sha256");
  if (!existsSync(manifestPath)) return { ok: false, reason: "assets-manifest-missing" };
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    return { ok: false, reason: "assets-manifest-mismatch" };
  }
  if (text.includes("\u0000")) return { ok: false, reason: "assets-manifest-mismatch" };
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return { ok: false, reason: "assets-manifest-mismatch" };
  const want = new Map<string, string>();
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (\S+)$/.exec(line);
    if (!match) return { ok: false, reason: "assets-manifest-mismatch" };
    const rel = match[2];
    if (rel.includes("\\") || rel.startsWith("/")) return { ok: false, reason: "assets-manifest-mismatch" };
    const parts = rel.split("/");
    if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
      return { ok: false, reason: "assets-manifest-mismatch" };
    }
    if (rel === "MANIFEST.sha256" || rel === "UNREPRODUCED" || want.has(rel)) {
      return { ok: false, reason: "assets-manifest-mismatch" };
    }
    want.set(rel, match[1]);
  }
  const present = listAssetFiles(assets, "");
  if (present === null) return { ok: false, reason: "assets-manifest-mismatch" };
  const files = present.filter((rel) => rel !== "MANIFEST.sha256");
  if (files.length !== want.size) return { ok: false, reason: "assets-manifest-mismatch" };
  for (const rel of files) {
    const expected = want.get(rel);
    if (expected === undefined) return { ok: false, reason: "assets-manifest-mismatch" };
    let bytes: Buffer;
    try {
      bytes = readFileSync(assetPath(assets, rel));
    } catch {
      return { ok: false, reason: "assets-manifest-mismatch" };
    }
    if (createHash("sha256").update(bytes).digest("hex") !== expected) {
      return { ok: false, reason: "assets-manifest-mismatch" };
    }
  }
  return { ok: true };
}

function checkAssets(root: string): GuardResult {
  const assets = join(root, "deploy/assets");
  if (!existsSync(assets)) return { ok: false, reason: "assets-manifest-missing" };
  const names = readdirSync(assets);
  if (names.includes("UNREPRODUCED")) return { ok: false, reason: "assets-unreproduced" };
  return checkManifest(assets);
}

export function guardRoot(root: string, mode: GuardMode): GuardResult {
  if (existsSync(join(root, ".dev.vars"))) return { ok: false, reason: "dev-vars-present" };
  const configPath = join(root, "wrangler.jsonc");
  if (!existsSync(configPath)) return { ok: false, reason: "config-missing" };
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(stripJsonc(readFileSync(configPath, "utf8"))) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "config-unreadable" };
  }
  if (Object.hasOwn(config, "vars")) return { ok: false, reason: "vars-present" };
  if (config.keep_vars !== true) return { ok: false, reason: "keep-vars-required" };
  if (!migrationOk(config)) return { ok: false, reason: "migration-shape" };
  if (mode === "deploy") return checkAssets(root);
  return { ok: true };
}

const entry = process.argv[1] ?? "";
if (entry.endsWith(`${"guard"}.ts`) || entry.endsWith(`${"guard"}.js`)) {
  const mode = process.argv[2];
  if (mode !== "dry-run" && mode !== "deploy") {
    console.error("deploy.sh: unsupported arguments");
    process.exit(2);
  }
  const result = guardRoot(process.cwd(), mode);
  if (!result.ok) {
    console.error(`deploy.sh: ${result.reason}`);
    process.exit(2);
  }
}
