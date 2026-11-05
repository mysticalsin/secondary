import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "@playwright/test";

/** Screenshots land in .dev/e2e-shots (git-ignored), apart from Playwright's own output folder. */
const DIR = fileURLToPath(new URL("../.dev/e2e-shots/", import.meta.url));
mkdirSync(DIR, { recursive: true });
export const shot = (name: string) => `${DIR}${name}.png`;

export const PERSONA_KEY = "secondary.persona";

/** A page whose app talks to the API as this dev persona (the same switch the header offers). */
export async function asPersona(
  browser: Browser,
  persona: string,
  opts: { tour?: boolean; locale?: string; width?: number; height?: number } = {},
): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 1360, height: opts.height ?? 860 },
    reducedMotion: "reduce",
    ...(opts.locale ? { locale: opts.locale } : {}),
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k as string, v as string),
    [PERSONA_KEY, persona],
  );
  // The first-run tour stays out of the way unless a test asks for it.
  await page.request.fetch("/v1/ux/prefs", {
    method: "PUT",
    headers: { "X-Demo-Persona": persona, "Content-Type": "application/json" },
    data: JSON.stringify({ tourDone: !opts.tour, lang: null }),
  });
  return page;
}

/** Fetch JSON from the API as a persona (no browser UI). */
export async function api(
  page: Page,
  persona: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
) {
  const res = await page.request.fetch(path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "X-Demo-Persona": persona, "Content-Type": "application/json" },
    ...(init.body ? { data: JSON.stringify(init.body) } : {}),
  });
  return {
    status: res.status(), // biome-ignore lint/suspicious/noExplicitAny: test JSON bodies are untyped on purpose
    json: (await res.json().catch(() => null)) as any,
  };
}
