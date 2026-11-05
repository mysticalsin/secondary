import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

// Stub: the append-only audit write lands in a later phase.
app.post("/append", (c) => c.json({ ok: true, stub: true }, 202));

export default app;
