// Where the local stack listens. Defaults match `pnpm dev:all`; set DEV_API_PORT / DEV_MCP_PORT (the same
// variables scripts/dev-all.mjs reads) to run the suite against a second stack on other ports.
export const API_URL = `http://localhost:${process.env.DEV_API_PORT ?? "8787"}`;
export const MCP_URL = `http://localhost:${process.env.DEV_MCP_PORT ?? "8788"}`;
