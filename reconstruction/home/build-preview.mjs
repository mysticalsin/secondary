/**
 * Build the same Second Brain home the release edge renders, as files that open
 * without a server. This folder is not a signed-in session and has no records.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { renderHome, renderObservability, renderPersonal, renderImport } from "../ui/pages.mjs";

const links = [
  ["index.html", "Home"],
  ["personal.html", "Personal brain"],
  ["import.html", "Import"],
  ["observability.html", "Observability"],
  ["activity.html", "Activity"],
];

const previewBanner = "Opened from a file on this computer. No account was contacted. This file has no review records.";

const home = renderHome({
  surface: "preview",
  who: "Not signed in",
  tenant: "Not connected",
  links,
  currentHref: "index.html",
  brain: { state: "empty", shown: null, total: null, coverage: null, detail: "No personal brain is loaded in this file. Nothing has been imported here." },
  activity: { state: "empty", count: null, detail: "No review records are in this file." },
  usage: { state: "unknown", detail: "Usage was not loaded. Cost is unknown. Unknown is not zero." },
  notice: "",
});

const observability = renderObservability({
  roleLabel: "File preview",
  principalId: "not signed in",
  tenantId: "not connected",
  persona: "none",
  prefMessage: "",
  section: "status",
  release: true,
  preset: "person_a",
  routes: [],
  ready: { kind: "unknown", label: "Unknown", detail: "This file does not measure readiness.", technical: "" },
  health: { kind: "unknown", label: "Unknown", detail: "No live uptime is measured." },
  ai: { kind: "unknown", label: "Disabled", detail: "No model is called." },
  agentRows: "<p>No agent rows are in this file.</p>",
  audit: { kind: "unknown", label: "Not loaded", detail: "Audit was not requested from this file.", raw: "" },
  lang: "",
  ledger: { status: 0, events: [], summary: null, error: "", operation: "", trust: "", requestId: "" },
  banner: previewBanner,
  identity: "This file is not signed in.",
  allowImport: false,
  links,
  currentHref: "observability.html",
});

const activity = renderObservability({
  roleLabel: "File preview",
  principalId: "not signed in",
  tenantId: "not connected",
  persona: "none",
  prefMessage: "",
  section: "activity",
  release: true,
  preset: "person_a",
  routes: [],
  ready: { kind: "unknown", label: "Unknown", detail: "This file does not measure readiness.", technical: "" },
  health: { kind: "unknown", label: "Unknown", detail: "No live uptime is measured." },
  ai: { kind: "unknown", label: "Disabled", detail: "No model is called." },
  agentRows: "<p>No agent rows are in this file.</p>",
  audit: { kind: "unknown", label: "Not loaded", detail: "Audit was not requested from this file.", raw: "" },
  lang: "",
  ledger: { status: 0, events: [], summary: null, error: "", operation: "", trust: "", requestId: "" },
  activity: {
    items: [],
    detail: null,
    empty: true,
    snapshot_complete: true,
    message: "Nothing has been imported into this file.",
    failed: false,
    q: "",
    capture: "",
    kind: "",
    date: "",
  },
  banner: previewBanner,
  identity: "This file is not signed in.",
  allowImport: false,
  activityAction: "activity.html",
  links,
  currentHref: "activity.html",
});

const personal = renderPersonal({
  status: 200,
  email: "Not signed in",
  links,
  currentHref: "personal.html",
  plan: { empty: true, principalId: "Not signed in", tenantId: "Not connected", context: [], shown: 0, total: 0, coverage: "full" },
});

const imported = renderImport({
  who: "Not signed in",
  tenant: "Not connected",
  message: "This file cannot store a note. Open the reconstructed app to import.",
  items: [],
  kept: 0,
  total: 0,
  shown: 0,
  coverage: "full",
  preset: "person_a",
  release: true,
  links,
  currentHref: "import.html",
});

const files = {
  "index.html": home,
  "observability.html": observability,
  "activity.html": activity,
  "personal.html": personal,
  "import.html": imported,
};

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: node reconstruction/home/build-preview.mjs <directory>");
mkdirSync(outDir, { recursive: true });
for (const [name, html] of Object.entries(files)) {
  writeFileSync(`${outDir}/${name}`, html);
}
writeFileSync(`${outDir}/RUN.txt`, `Mantu Second Brain — home preview

Open index.html in this folder. It is the same home screen the reconstructed app renders at /.
This folder is not signed in. It does not contain review records, credentials, or a live session.
Personal brain, Import, Observability, and Activity are the same renderers with empty or unknown data.
The deployed app you already saw is older and does not include this home screen.

From this folder you can also run:
  python3 -m http.server 43158 --bind 127.0.0.1
and open http://127.0.0.1:43158/
`);
console.log(dirname(`${outDir}/index.html`));
