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
  if (mode === "deploy") {
    const assets = join(root, "deploy/assets");
    const names = existsSync(assets) ? readdirSync(assets) : [];
    if (names.includes("UNREPRODUCED")) return { ok: false, reason: "assets-unreproduced" };
  }
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
