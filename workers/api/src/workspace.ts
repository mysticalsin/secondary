import { DurableObject } from "cloudflare:workers";

export class Workspace extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/health") {
      return Response.json({ ok: true, object: "Workspace" });
    }
    return new Response("not found", { status: 404 });
  }
}
