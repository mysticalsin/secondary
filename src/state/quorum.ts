/**
 * Second-person confirmation. The first actor records an ask. A different
 * person confirms it. The requester can never be the confirmer.
 * Two directory subjects are the same only when they are equal. Otherwise any
 * normalised address matches: the sign-in address or the directory email.
 * A display name is not an identity.
 */

import { actorFromDirectory, normalEmail, normalSubject, sameActor, type ActorIdentity } from "./actor.ts";
import { commit, type IllegalTransition, reject } from "./illegal.ts";

export { actorFromDirectory, normalEmail, normalSubject, sameActor, type ActorIdentity };

export const SECOND_PERSON_TTL_MS = 24 * 3_600_000;

export type QuorumState =
  | { tag: "empty" }
  | { tag: "waiting"; requester: ActorIdentity; requestedAt: number };

export type QuorumEvent = { type: "ask"; actor: ActorIdentity; now: number };

export type QuorumEffect =
  | { type: "upsert"; requesterId: string; requestedAt: number }
  | { type: "delete"; requesterId: string; requestedAt: number }
  | { type: "none" };

export type QuorumDecision = "recorded" | "same_actor" | "confirmed";

export type QuorumStep =
  | {
      ok: true;
      state: QuorumState;
      effects: QuorumEffect[];
      decision: QuorumDecision;
    }
  | IllegalTransition;

export type QuorumResult =
  | { tag: "recorded" }
  | { tag: "same_actor" }
  | { tag: "confirmed" }
  | { tag: "replay" }
  | { tag: "refused" };

export function transitionQuorum(state: QuorumState, event: QuorumEvent): QuorumStep {
  if (!Number.isSafeInteger(event.now)) {
    return reject("quorum", state.tag, event.type, "clock_unreadable");
  }
  if (event.actor.id.trim() === "") {
    return reject("quorum", state.tag, event.type, "actor_required");
  }
  const actor: ActorIdentity = {
    id: event.actor.id,
    subject: normalSubject(event.actor.subject),
    email: normalEmail(event.actor.email),
    directoryEmail: normalEmail(event.actor.directoryEmail),
  };
  const expired =
    state.tag === "waiting" && state.requestedAt <= event.now - SECOND_PERSON_TTL_MS;
  if (state.tag === "empty" || expired) {
    return {
      ok: true,
      state: { tag: "waiting", requester: actor, requestedAt: event.now },
      effects: [{ type: "upsert", requesterId: actor.id, requestedAt: event.now }],
      decision: "recorded",
    };
  }
  if (sameActor(state.requester, actor)) {
    return { ok: true, state, effects: [{ type: "none" }], decision: "same_actor" };
  }
  return {
    ok: true,
    state: { tag: "empty" },
    effects: [
      { type: "delete", requesterId: state.requester.id, requestedAt: state.requestedAt },
    ],
    decision: "confirmed",
  };
}

export const commitQuorum = (state: QuorumState, event: QuorumEvent): QuorumStep =>
  commit(transitionQuorum(state, event));

/** Only a completed confirm applies the caller's change. Replay does not. */
export function quorumConfirmed(result: QuorumResult): boolean {
  return result.tag === "confirmed";
}
