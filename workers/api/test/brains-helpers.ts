// Shared by the v3 brains tests.

import { as, json, type Loose } from "./helpers.ts";

export const brains = (persona: string, email: string, path = "", o: Loose = {}) =>
  as(persona, `/v1/brains${path}`, { email, ...o });

export const get = async <T = Loose>(persona: string, email: string, path: string): Promise<T> =>
  json<T>(await brains(persona, email, path));

export const put = (persona: string, email: string, path: string, body: Loose) =>
  brains(persona, email, path, { method: "PUT", body });

export const post = (persona: string, email: string, path: string, body: Loose = {}) =>
  brains(persona, email, path, { method: "POST", body });

/** The id a persona's principal has in this tenant (dev personas sign in under their own address). */
export const idOf = async (persona: string, email: string): Promise<string> =>
  (await json(await as(persona, "/v1/me", { email }))).principal.id as string;

/** A zip with stored entries, written the way the OKF export writes them. */
export { zip } from "../src/uxv2/zip.ts";

export const bytesOf = (files: Record<string, string>, now = Date.now()) =>
  // imported lazily so a test file can also build malformed archives by hand
  import("../src/uxv2/zip.ts").then((m) =>
    m.zip(
      Object.entries(files).map(([path, content]) => ({ path, content })),
      now,
    ),
  );
