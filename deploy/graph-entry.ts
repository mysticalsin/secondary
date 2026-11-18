import app from "../recovered-source/worker/src/index.ts";
import dashboardCss from "./graph/dashboard.css";
import dashboard from "./graph/dashboard.html";
import dashboardJs from "./graph/dashboard.js.txt";
import appCss from "./graph/app.css";
import appJs from "./graph/app.js.txt";
import navCss from "./graph/nav.css";
import navJs from "./graph/nav.js.txt";
import page from "./graph/page.html";
import { graphFetch, type GraphFiles } from "./graph-route.ts";

export * from "../recovered-source/worker/src/index.ts";

const files: GraphFiles = {
  "/graph": [page, "text/html; charset=utf-8"],
  "/graph/app.js": [appJs, "text/javascript; charset=utf-8"],
  "/graph/app.css": [appCss, "text/css; charset=utf-8"],
  "/graph/nav.js": [navJs, "text/javascript; charset=utf-8"],
  "/graph/nav.css": [navCss, "text/css; charset=utf-8"],
  "/dashboard": [dashboard, "text/html; charset=utf-8"],
  "/graph/dashboard.js": [dashboardJs, "text/javascript; charset=utf-8"],
  "/graph/dashboard.css": [dashboardCss, "text/css; charset=utf-8"],
};

export default {
  fetch(
    request: Request,
    env: Parameters<typeof app.fetch>[1],
    ctx: Parameters<typeof app.fetch>[2],
  ) {
    return graphFetch(request, files, (next) => app.fetch(next, env, ctx));
  },
};
