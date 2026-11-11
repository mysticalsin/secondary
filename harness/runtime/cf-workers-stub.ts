/** Test stand-in so the recovered Durable Object module can load under Node. */

export class DurableObject<T = unknown> {
  ctx: unknown;
  env: T;

  constructor(ctx: unknown, env: T) {
    this.ctx = ctx;
    this.env = env;
  }
}
