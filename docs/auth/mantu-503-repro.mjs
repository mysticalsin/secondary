import { generateKeyPairSync } from "node:crypto";
const worker = (await import(process.argv[2] + "/worker/entry.js")).default;
const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const j = publicKey.export({ format: "jwk" });
const jwk = { kty: j.kty, n: j.n, e: j.e, alg: "RS256", use: "sig", kid: "qa-synthetic" };
const fake = { fetch: async () => new Response("{}", { status: 404 }) };
const envs = {
  "unconfigured (wrangler.jsonc vars: empty issuer/audience)": { RELEASE_MODE: "protected-dev", AUTH_ISSUER: "", AUTH_AUDIENCE: "", API: fake, MCP: fake },
  "configured LOCAL_JWKS (fake public key, synthetic issuer/aud)": { RELEASE_MODE: "protected-dev", AUTH_ISSUER: "https://issuer.synthetic.test", AUTH_AUDIENCE: "synthetic-aud", LOCAL_JWKS: JSON.stringify({ keys: [jwk] }), INTERNAL_HMAC_KEY: "x".repeat(64), API: fake, MCP: fake },
  "configured remote JWKS URL (never fetched for no-token)": { RELEASE_MODE: "protected-dev", AUTH_ISSUER: "https://issuer.synthetic.test", AUTH_AUDIENCE: "synthetic-aud", AUTH_JWKS_URL: "https://issuer.synthetic.test/certs", ADMITTED_TENANT_DOMAINS: "{}", API: fake, MCP: fake },
};
for (const [name, env] of Object.entries(envs)) {
  for (const [label, headers] of [["no identity", {}], ["bad bearer", { authorization: "Bearer not-a-token" }]]) {
    if (name.startsWith("configured remote") && label === "bad bearer") continue; // avoid any network attempt
    const r = await worker.fetch(new Request("http://127.0.0.1/", { headers }), env);
    console.log(`${name} | ${label} | GET / -> ${r.status} ${(await r.text()).trim()}`);
  }
}
