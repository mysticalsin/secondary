import { Hono } from "hono";

const SWITCHES = ["mcp", "connector", "ai", "contribute"] as const;
type SwitchName = (typeof SWITCHES)[number];
type Switches = Record<SwitchName, boolean>;

export const SWITCH_PATHS: { method: string; path: string }[] = [
  { method: "POST", path: "/v1/personal/items/pi:abcd1234/contribute" },
  { method: "GET", path: "/v1/personal/items/pi:abcd1234/contribute" },
  { method: "POST", path: "/personal/items/pi:abcd1234/contribute" },
  { method: "POST", path: "/v1/actions" },
  { method: "POST", path: "/v1/genui/plan" },
  { method: "POST", path: "/genui/plan" },
  { method: "GET", path: "/v1/ai/status" },
  { method: "POST", path: "/v1/ai/chat" },
  { method: "GET", path: "/v1/ai" },
  { method: "POST", path: "/v1/briefs" },
  { method: "POST", path: "/v1/briefs/save" },
  { method: "GET", path: "/v1/briefs/x" },
  { method: "GET", path: "/briefs/save" },
  { method: "GET", path: "/v1/connectors/acme" },
  { method: "GET", path: "/v1/sources/s1" },
  { method: "GET", path: "/v1/sources" },
  { method: "GET", path: "/sources/s1" },
  { method: "GET", path: "/v1/map" },
  { method: "POST", path: "/v1/admin/switches" },
  { method: "POST", path: "/v1/personal/items/pi:abcd1234/contribute/" },
  { method: "GET", path: "/v1/sources/s1/" },
  { method: "GET", path: "/v1/Sources/s1" },
  { method: "GET", path: "/V1/sources/s1" },
  { method: "GET", path: "/v1/%73ources/s1" },
  { method: "GET", path: "/v1//sources/s1" },
  { method: "GET", path: "/v1/sources/s1?x=1" },
  { method: "HEAD", path: "/v1/sources/s1" },
  { method: "OPTIONS", path: "/v1/sources/s1" },
  { method: "GET", path: "/v1x/sources/s1" },
  { method: "GET", path: "/v10/sources/s1" },
];

const allOn = (): Switches => ({ mcp: true, connector: true, ai: true, contribute: true });

function states(): { label: string; switches: Switches }[] {
  const out = [{ label: "all-on", switches: allOn() }];
  for (const name of SWITCHES) {
    const switches = allOn();
    switches[name] = false;
    out.push({ label: `${name}-off`, switches });
  }
  out.push({
    label: "all-off",
    switches: { mcp: false, connector: false, ai: false, contribute: false },
  });
  return out;
}

export type SwitchRow = {
  method: string;
  path: string;
  internal: boolean;
  state: string;
  status: number;
  body: unknown;
};

export async function collectSwitchTable(): Promise<SwitchRow[]> {
  const mod = (await import(
    new URL("../../src/worker/ops-admin.ts", import.meta.url).href
  )) as {
    switchGate: (c: { set: Function; get: Function; req: { method: string; url: string }; json: Function }, next: () => Promise<void>) => Promise<Response | void>;
  };
  const rows: SwitchRow[] = [];
  for (const internal of [false, true]) {
    for (const state of states()) {
      const app = new Hono<{
        Variables: { session: { switches: Switches; internal: { clientId: string } | null } };
      }>();
      app.use("*", async (c, next) => {
        c.set("session", { switches: state.switches, internal: internal ? { clientId: "c" } : null });
        await next();
      });
      app.use("*", mod.switchGate as never);
      app.all("*", (c) => c.json({ ok: true }));
      for (const route of SWITCH_PATHS) {
        const res = await app.request(`http://127.0.0.1${route.path}`, { method: route.method });
        const text = await res.text();
        const body = text.length ? (JSON.parse(text) as unknown) : null;
        rows.push({
          method: route.method,
          path: route.path,
          internal,
          state: state.label,
          status: res.status,
          body,
        });
      }
    }
  }
  return rows;
}
