/** A transition the table does not allow. Pure value. Logging happens in `commit`. */

export type IllegalTransition = {
  ok: false;
  machine: string;
  from: string;
  event: string;
  reason: string;
};

export const reject = (
  machine: string,
  from: string,
  event: string,
  reason: string,
): IllegalTransition => ({ ok: false, machine, from, event, reason });

/** Log an illegal transition and return it. Legal results pass through with no I/O. */
export function commit<T extends { ok: boolean }>(result: T): T {
  if (!result.ok) {
    const bad = result as T & IllegalTransition;
    console.warn(
      JSON.stringify({
        at: "illegal_transition",
        machine: bad.machine,
        from: bad.from,
        event: bad.event,
        reason: bad.reason,
      }),
    );
  }
  return result;
}
