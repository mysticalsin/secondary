// Rate limits for the OAuth endpoints (B1 L4), counted per client address in OAUTH_KV:
//   /register   OAUTH_REGISTER_PER_MIN (default 10), OAUTH_REGISTER_PER_DAY (50) per address, and
//               OAUTH_REGISTER_GLOBAL_PER_DAY (2000) in all, so open client registration cannot grow KV without bound
//   /token      OAUTH_TOKEN_PER_MIN (default 60)
//   /authorize  OAUTH_AUTHORIZE_PER_MIN (default 60)
// The address is CF-Connecting-IP, which the edge sets and a client cannot forge. Requests without it do
// not come from the internet (service bindings, local runs) and are not counted. Counters are plain
// KV read and write, so a burst can slip a few requests past a cap; the Cloudflare rate limiting rule in
// docs/runbooks/MCP-EDGE-LIMITS.md is the sharp edge in front of this one. Only a hash of the address is stored.

const MINUTE = 60;
const DAY = 86_400;

const int = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

interface Counter {
  key: string;
  limit: number;
  /** Seconds until the window ends. */
  retry: number;
  ttl: number;
}

const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)]
    .slice(0, 8)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

export async function rateLimited(request: Request, env: Env): Promise<Response | null> {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return null;
  const path = new URL(request.url).pathname;
  const e = env as unknown as Record<string, string | undefined>;
  const nowS = Math.floor(Date.now() / 1000);
  const id = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`rl:${ip}`)));
  const minute = (name: string, limit: number): Counter => ({
    key: `rl:${name}:${id}:m:${Math.floor(nowS / MINUTE)}`,
    limit,
    retry: MINUTE - (nowS % MINUTE),
    ttl: 2 * MINUTE,
  });
  const day = (name: string, who: string, limit: number): Counter => ({
    key: `rl:${name}:${who}:d:${Math.floor(nowS / DAY)}`,
    limit,
    retry: DAY - (nowS % DAY),
    ttl: DAY + 3600,
  });

  let counters: Counter[];
  if (path === "/register" && request.method === "POST")
    counters = [
      minute("register", int(e.OAUTH_REGISTER_PER_MIN, 10)),
      day("register", id, int(e.OAUTH_REGISTER_PER_DAY, 50)),
      day("register", "all", int(e.OAUTH_REGISTER_GLOBAL_PER_DAY, 2000)),
    ];
  else if (path === "/token" && request.method === "POST")
    counters = [minute("token", int(e.OAUTH_TOKEN_PER_MIN, 60))];
  else if (path === "/authorize")
    counters = [minute("authorize", int(e.OAUTH_AUTHORIZE_PER_MIN, 60))];
  else return null;

  try {
    const used = await Promise.all(
      counters.map(async (c) => Number.parseInt((await env.OAUTH_KV.get(c.key)) ?? "0", 10) || 0),
    );
    const over = counters.findIndex((c, i) => (used[i] as number) >= c.limit);
    if (over >= 0)
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "retry-after": String((counters[over] as Counter).retry) } },
      );
    await Promise.all(
      counters.map((c, i) =>
        env.OAUTH_KV.put(c.key, String((used[i] as number) + 1), { expirationTtl: c.ttl }),
      ),
    );
  } catch {
    // A KV failure must not lock everyone out: the provider needs the same KV and will fail on its own.
  }
  return null;
}
