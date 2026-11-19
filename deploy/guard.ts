import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type GuardMode = "dry-run" | "deploy";
export type GuardResult = { ok: true } | { ok: false; reason: string };

const MIGRATION_KEYS = ["deleted_classes", "renamed_classes", "transferred_classes", "new_classes"] as const;
const SOURCE_DIR = "deploy/assets";

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

function walkAssets(dir: string, prefix: string): { files: string[]; sentinel: boolean } | null {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];
  let sentinel = false;
  for (const entry of entries) {
    if (entry.name.toLowerCase() === "unreproduced") sentinel = true;
    const rel = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) return null;
    if (entry.isDirectory()) {
      const nested = walkAssets(join(dir, entry.name), rel);
      if (nested === null) return null;
      if (nested.sentinel) sentinel = true;
      files.push(...nested.files);
      continue;
    }
    if (!entry.isFile()) return null;
    files.push(rel);
  }
  return { files, sentinel };
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isSentinel(rel: string): boolean {
  return rel.split("/").some((part) => part.toLowerCase() === "unreproduced");
}

function uploadRelative(config: Record<string, unknown>): string | null {
  const assets = config.assets;
  if (typeof assets !== "object" || assets === null) return null;
  const value = (assets as { directory?: unknown }).directory;
  if (typeof value !== "string") return null;
  let text = value;
  if (text.startsWith("./")) text = text.slice(2);
  if (text.endsWith("/")) text = text.slice(0, -1);
  if (text.length === 0 || text.startsWith("/") || text.includes("\\") || text.includes("\0")) return null;
  const parts = text.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) return null;
  if (text === SOURCE_DIR || text.startsWith(`${SOURCE_DIR}/`)) return null;
  return text;
}

function readManifest(assets: string): { ok: false; reason: string } | { ok: true; files: Map<string, string> } {
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
    if (isSentinel(rel)) return { ok: false, reason: "assets-unreproduced" };
    if (rel.includes("\\") || rel.startsWith("/")) return { ok: false, reason: "assets-manifest-mismatch" };
    const parts = rel.split("/");
    if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
      return { ok: false, reason: "assets-manifest-mismatch" };
    }
    if (rel === "MANIFEST.sha256" || want.has(rel)) return { ok: false, reason: "assets-manifest-mismatch" };
    want.set(rel, match[1]);
  }
  return { ok: true, files: want };
}

export function copyThenRehash(
  destRoot: string,
  assets: string,
  files: Map<string, string>,
  afterCopy?: (dest: string) => void,
): GuardResult {
  mkdirSync(destRoot, { recursive: true });
  for (const [rel, expected] of files) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(assetPath(assets, rel));
    } catch {
      return { ok: false, reason: "assets-manifest-mismatch" };
    }
    if (createHash("sha256").update(bytes).digest("hex") !== expected) {
      return { ok: false, reason: "assets-manifest-mismatch" };
    }
    const dest = assetPath(destRoot, rel);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, bytes);
    if (afterCopy !== undefined) afterCopy(dest);
    const copy = readFileSync(dest);
    if (!bytes.equals(copy) || createHash("sha256").update(copy).digest("hex") !== expected) {
      return { ok: false, reason: "assets-manifest-mismatch" };
    }
  }
  const present = walkAssets(destRoot, "");
  if (present === null || present.sentinel || present.files.length !== files.size || present.files.some((rel) => !files.has(rel))) {
    return { ok: false, reason: "assets-manifest-mismatch" };
  }
  return { ok: true };
}

function verifySource(root: string): { ok: false; reason: string } | { ok: true; files: Map<string, string> } {
  const assets = join(root, SOURCE_DIR);
  if (!existsSync(assets)) return { ok: false, reason: "assets-manifest-missing" };
  const present = walkAssets(assets, "");
  if (present === null) return { ok: false, reason: "assets-manifest-mismatch" };
  if (present.sentinel) return { ok: false, reason: "assets-unreproduced" };
  const manifest = readManifest(assets);
  if (!manifest.ok) return manifest;
  const files = present.files.filter((rel) => rel !== "MANIFEST.sha256");
  if (files.length !== manifest.files.size || files.some((rel) => !manifest.files.has(rel))) {
    return { ok: false, reason: "assets-manifest-mismatch" };
  }
  for (const rel of files) {
    const expected = manifest.files.get(rel);
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
  return { ok: true, files: manifest.files };
}

function configuredDirectory(root: string, config: Record<string, unknown>): { ok: false; reason: string } | { ok: true; path: string } {
  const relativeDir = uploadRelative(config);
  if (relativeDir === null) return { ok: false, reason: "assets-directory-mismatch" };
  const path = join(root, relativeDir);
  if (existsSync(path)) return { ok: false, reason: "assets-directory-present" };
  return { ok: true, path };
}

function readConfig(root: string): { ok: true; config: Record<string, unknown> } | { ok: false; reason: string } {
  if (existsSync(join(root, ".dev.vars"))) return { ok: false, reason: "dev-vars-present" };
  const configPath = join(root, "wrangler.jsonc");
  if (!existsSync(configPath)) return { ok: false, reason: "config-missing" };
  try {
    const config = JSON.parse(stripJsonc(readFileSync(configPath, "utf8"))) as Record<string, unknown>;
    return { ok: true, config };
  } catch {
    return { ok: false, reason: "config-unreadable" };
  }
}

export function guardRoot(root: string, mode: GuardMode): GuardResult {
  const parsed = readConfig(root);
  if (!parsed.ok) return parsed;
  const config = parsed.config;
  if (Object.hasOwn(config, "vars")) return { ok: false, reason: "vars-present" };
  if (config.keep_vars !== true) return { ok: false, reason: "keep-vars-required" };
  if (!migrationOk(config)) return { ok: false, reason: "migration-shape" };
  const configured = configuredDirectory(root, config);
  if (!configured.ok) return configured;
  if (mode === "deploy") {
    const verified = verifySource(root);
    if (!verified.ok) return verified;
  }
  return { ok: true };
}

export function stageDeploy(root: string, dest: string): GuardResult {
  const parsed = readConfig(root);
  if (!parsed.ok) return parsed;
  const config = parsed.config;
  if (Object.hasOwn(config, "vars")) return { ok: false, reason: "vars-present" };
  if (config.keep_vars !== true) return { ok: false, reason: "keep-vars-required" };
  if (!migrationOk(config)) return { ok: false, reason: "migration-shape" };
  const configured = configuredDirectory(root, config);
  if (!configured.ok) return configured;
  if (isInside(configured.path, dest) || isInside(join(root, SOURCE_DIR), dest)) {
    return { ok: false, reason: "assets-directory-mismatch" };
  }
  const verified = verifySource(root);
  if (!verified.ok) return verified;
  return copyThenRehash(dest, join(root, SOURCE_DIR), verified.files);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith(`${"guard"}.ts`) || entry.endsWith(`${"guard"}.js`)) {
  const mode = process.argv[2];
  const dest = process.argv[3];
  if (mode !== "dry-run" && mode !== "deploy") {
    console.error("deploy.sh: unsupported arguments");
    process.exit(2);
  }
  if (dest !== undefined && mode !== "deploy") {
    console.error("deploy.sh: unsupported arguments");
    process.exit(2);
  }
  const result = mode === "deploy" && dest !== undefined ? stageDeploy(process.cwd(), dest) : guardRoot(process.cwd(), mode);
  if (!result.ok) {
    console.error(`deploy.sh: ${result.reason}`);
    process.exit(2);
  }
}
