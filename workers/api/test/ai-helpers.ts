import { createLocalJWKSet } from "jose";
import { createApp } from "../src/index.ts";
import { publicJwk, sign, testEnv } from "./helpers.ts";

const jwks = createLocalJWKSet({ keys: [publicJwk] });

export type ModelCall = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** The user turn, for prompt assertions. */
  user: string;
  system: string;
};

export type Reply = Record<string, unknown> | string;

/** A stand-in for api.anthropic.com. `reply` sees the parsed request and returns the model's text or JSON. */
export function stubModel(
  reply: (call: ModelCall, n: number) => Reply | Response = () => ({ title: "T", sections: [] }),
  usage = { input_tokens: 400, output_tokens: 120 },
) {
  const calls: ModelCall[] = [];
  const fetchStub = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const msgs = body.messages as { content: string }[];
    const sys = body.system as { text: string }[];
    const call: ModelCall = {
      url,
      headers: init?.headers as Record<string, string>,
      body,
      user: msgs.map((m) => m.content).join("\n"),
      system: sys.map((s) => s.text).join("\n"),
    };
    calls.push(call);
    const r = reply(call, calls.length);
    if (r instanceof Response) return r;
    return Response.json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: typeof r === "string" ? r : JSON.stringify(r) }],
      stop_reason: "end_turn",
      usage,
    });
  };
  return { fetch: fetchStub, calls };
}

export const KEY = {
  ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key",
  AI_ENABLED: "true",
  AI_PROCESSOR_CONTRACT: "approved",
};

export async function aiCall(
  persona: string,
  path: string,
  o: {
    body?: unknown;
    method?: string;
    env?: Record<string, unknown>;
    fetch?: (url: string, init?: RequestInit) => Promise<Response>;
    domain?: string;
  } = {},
): Promise<Response> {
  const app = createApp({
    jwks: () => jwks,
    sleep: async () => {},
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
  const token = await sign(`${persona}@${o.domain ?? "example.invalid"}`);
  const hasBody = o.body !== undefined;
  return app.fetch(
    new Request(`https://secondary.example.test${path}`, {
      method: o.method ?? (hasBody ? "POST" : "GET"),
      headers: {
        "Cf-Access-Jwt-Assertion": token,
        "X-Demo-Persona": persona,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(o.body) } : {}),
    }),
    testEnv(o.env),
  );
}
