/**
 * NEW RECONSTRUCTION local fixture. Not the original host.
 * Serves preserved capture bytes at the paths the recovered shell names.
 * Does not modify those bytes and does not contact the live app, fonts, or logos.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

export const CAPTURED = {
  "/": `${root}/recovered-delivery/html-shell/index.html`,
  "/index.html": `${root}/recovered-delivery/html-shell/index.html`,
  "/assets/index-PLmoiPYI.js": `${root}/recovered-delivery/main-js/index-PLmoiPYI.dom-captured.js`,
  "/assets/index-DiBYRwP4.css": `${root}/recovered-delivery/shell-six/assets/index-DiBYRwP4.css`,
  "/assets/PinnedGrid-CuaLdMPY.js": `${root}/recovered-delivery/shell-six/assets/PinnedGrid-CuaLdMPY.js`,
  "/assets/Renderer-0G0MSIPy.js": `${root}/recovered-delivery/shell-six/assets/Renderer-0G0MSIPy.js`,
  "/assets/ViewCard-D5JbjyDb.js": `${root}/recovered-delivery/shell-six/assets/ViewCard-D5JbjyDb.js`,
  "/assets/agent-DA0iqiiF.js": `${root}/recovered-delivery/shell-six/assets/agent-DA0iqiiF.js`,
  "/assets/agent-Wsu4vetM.css": `${root}/recovered-delivery/shell-six/assets/agent-Wsu4vetM.css`,
  "/assets/AgentPage-DHJmJKpV.js": `${root}/recovered-delivery/lazy-six/assets/AgentPage-DHJmJKpV.js`,
  "/assets/AgentPanel-Dn16YgEH.js": `${root}/recovered-delivery/lazy-six/assets/AgentPanel-Dn16YgEH.js`,
  "/assets/BrainViews-DoMdPJUS.js": `${root}/recovered-delivery/lazy-six/assets/BrainViews-DoMdPJUS.js`,
  "/assets/SettingsSection-f2wwgrYJ.js": `${root}/recovered-delivery/lazy-six/assets/SettingsSection-f2wwgrYJ.js`,
  "/assets/SharedView-CEqhSdzS.js": `${root}/recovered-delivery/lazy-six/assets/SharedView-CEqhSdzS.js`,
  "/assets/Thread-eq9OCIoK.js": `${root}/recovered-delivery/lazy-six/assets/Thread-eq9OCIoK.js`,
  "/assets/index-DZRyvnzT.js": `${root}/recovered-delivery/final-code/assets/index-DZRyvnzT.js`,
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const SYNTHETIC_ME = {
  principal: {
    id: "u_consultant",
    email: "synthetic@example.invalid",
    roleIds: ["consultant"],
  },
  tenantId: "tenant_reconstruction",
  persona: null,
  describe: { see: [], do: [], never: [] },
  env: "reconstruction",
  capabilities: { configure: false, review: false },
  seeded: false,
  synthetic: true,
};

export function fixtureResponse(url) {
  const path = url.pathname;
  if (path === "/v1/me" && url.search === "") {
    return {
      status: 200,
      type: "application/json; charset=utf-8",
      body: JSON.stringify(SYNTHETIC_ME),
    };
  }
  if (path.startsWith("/v1/")) {
    return {
      status: 501,
      type: "application/json; charset=utf-8",
      body: JSON.stringify({ error: "synthetic_gap", path, synthetic: true }),
    };
  }
  if (path.startsWith("/brand/") || /\.(?:woff2?|png|svg)$/i.test(path)) {
    return {
      status: 404,
      type: "text/plain; charset=utf-8",
      body: `missing non-code asset\n${path}\nnot fetched\n`,
    };
  }
  const file = CAPTURED[path];
  if (!file) {
    return { status: 404, type: "text/plain; charset=utf-8", body: `not in the captured fixture\n${path}\n` };
  }
  return {
    status: 200,
    type: TYPES[extname(file)] ?? "application/octet-stream",
    body: readFileSync(file),
  };
}

export function listen(port = 0) {
  const server = createServer((req, res) => {
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("local fixture only\n");
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const out = fixtureResponse(url);
    res.writeHead(out.status, {
      "content-type": out.type,
      "cache-control": "no-store",
      "x-secondary-fixture": "reconstruction",
    });
    res.end(out.body);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : port });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = await listen(43127);
  console.log(`http://127.0.0.1:${started.port}`);
}
