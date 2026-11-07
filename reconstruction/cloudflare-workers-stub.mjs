/**
 * Isolated test stand-in for the `cloudflare:workers` module specifier.
 * It lets Node load recovered classes. It is not the Workers runtime and it
 * has no storage, RPC, or network.
 */
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}

/** Present so recovered Workflow classes can load. This is not the Workers runtime. */
export class WorkflowEntrypoint {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class EmailMessage {}

export class WorkerEntrypoint {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class RpcTarget {}

export const exports = {};
