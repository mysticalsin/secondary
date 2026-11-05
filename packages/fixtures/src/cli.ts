import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SEED, type FileMap, generate, hashFiles, sampleOf } from "./generate.ts";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const seedArg = args.indexOf("--seed");
const seed = seedArg >= 0 ? Number(args[seedArg + 1]) : DEFAULT_SEED;
if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");

function write(dirName: "out" | "sample", files: FileMap): void {
  const dir = join(pkgDir, dirName); // fixed under the package: nothing outside it is touched
  rmSync(dir, { recursive: true, force: true });
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  console.log(`${dirName}/: ${Object.keys(files).length} files`);
}

const files = generate({ seed });
write("out", files);
if (args.includes("--sample")) write("sample", sampleOf(files));
console.log(`seed=${seed} sha256=${hashFiles(files)}`);
