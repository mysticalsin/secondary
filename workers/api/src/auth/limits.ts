// Session lifetimes and cookie names. Shared by the Durable Object store and the HTTP layer.

export const ABSOLUTE_MS = 8 * 3_600_000;
export const IDLE_MS = 30 * 60_000;
export const LOGIN_STATE_MS = 10 * 60_000;
export const MAX_SESSIONS_PER_PRINCIPAL = 10;
export const MAX_LOGIN_STATES = 1_000;
/** Sign-ins one address may have pending at once (L-07). */
export const MAX_LOGIN_STATES_PER_IP = 10;

export const SESSION_COOKIE = "__Host-secondary_session";
export const LOGIN_COOKIE = "__Host-secondary_login";
