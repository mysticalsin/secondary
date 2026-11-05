// `pnpm e2e:mcp [persona]` runs the scripted MCP host against http://localhost:8788 (pnpm dev:all).
import { runMcpFlow } from "./mcp-flow.ts";
import { MCP_URL } from "./ports.ts";

const persona = process.argv[2] ?? "ceo";
runMcpFlow(MCP_URL, persona).then(
  (r) => {
    console.log(JSON.stringify(r, null, 2));
  },
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
