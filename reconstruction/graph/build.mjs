import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, "client", name), "utf8");

// Same policy the live app's securityHeaders middleware sets (recovered security.ts).
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export function graphFiles() {
  return {
    "/graph": [read("graph.html"), "text/html; charset=utf-8"],
    "/graph/app.js": [read("graph.js"), "text/javascript; charset=utf-8"],
    "/graph/app.css": [read("graph.css"), "text/css; charset=utf-8"],
    "/graph/nav.js": [read("nav.js"), "text/javascript; charset=utf-8"],
    "/graph/nav.css": [read("nav.css"), "text/css; charset=utf-8"],
    "/dashboard": [read("dashboard.html"), "text/html; charset=utf-8"],
    "/graph/dashboard.js": [read("dashboard.js"), "text/javascript; charset=utf-8"],
    "/graph/dashboard.css": [read("dashboard.css"), "text/css; charset=utf-8"],
  };
}

export function wrapperSource() {
  const template = readFileSync(join(here, "wrapper.template.js"), "utf8");
  return template
    .replace('"__FILES__"', () => JSON.stringify(graphFiles()))
    .replace('"__CSP__"', () => JSON.stringify(CSP));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? join(here, "dist");
  mkdirSync(out, { recursive: true });
  const source = wrapperSource();
  writeFileSync(join(out, "graph-entry.js"), source);
  const sha = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, "graph-entry.js.sha256"), `${sha}  graph-entry.js\n`);
  console.log(join(out, "graph-entry.js"), source.length, sha);
}
