// Refuses a deploy whose api config does not pin the Durable Objects to the EU jurisdiction (B1 L6).
// Usage: node scripts/assert-eu.mjs <dev|staging|prod>   (called by scripts/deploy.sh before anything is built)

/** wrangler.jsonc to an object: strips // and /* comments outside strings and trailing commas. */
export function parseJsonc(src) {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === "\\") out += src[++i] ?? "";
      else if (c === '"') inStr = false;
      i++;
    } else if (c === '"') {
      inStr = true;
      out += c;
      i++;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** True when the vars the target deploys carry DO_JURISDICTION = "eu". */
export function pinnedToEu(config, target) {
  const vars = target === "dev" ? config.vars : config.env?.[target]?.vars;
  return vars?.DO_JURISDICTION === "eu";
}

if (typeof process !== "undefined" && process.argv[1]?.endsWith("assert-eu.mjs")) {
  const { readFileSync } = await import("node:fs");
  const target = process.argv[2] ?? "";
  // The api creates Durable Objects: it must say eu.
  for (const worker of ["api"]) {
    const path = new URL(`../workers/${worker}/wrangler.jsonc`, import.meta.url);
    if (
      !["dev", "staging", "prod"].includes(target) ||
      !pinnedToEu(parseJsonc(readFileSync(path, "utf8")), target)
    ) {
      console.error(
        `error: workers/${worker}/wrangler.jsonc must set DO_JURISDICTION to "eu" for ${target}`,
      );
      process.exit(1);
    }
  }
}
