/**
 * Same-origin fixture in front of the recovered API. No live network.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { callApi, probeEgress, stopRecoveredApi } from "../../reconstruction/fixture/recovered-api.mjs";
import { listen } from "../../reconstruction/fixture/serve.mjs";

async function open() {
  const started = await listen(0);
  const first = await fetch(`http://127.0.0.1:${started.port}/reconstruction/genui`);
  const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0];
  return { ...started, cookie, firstHtml: await first.text() };
}

test("recovered routes replace the synthetic gap and the genui flow stays on the session", async () => {
  const app = await open();
  try {
    const nav = await fetch(`http://127.0.0.1:${app.port}/v1/brains/nav`, { headers: { cookie: app.cookie } });
    const navJson = await nav.json();
    assert.equal(nav.status, 200);
    assert.equal(JSON.stringify(navJson).includes("synthetic_gap"), false);
    assert.equal(navJson.items.some((item) => item.type === "personal" && item.name === "My Secondary"), true);
    assert.equal(app.firstHtml.includes("My Secondary"), true);
    assert.equal(app.firstHtml.includes("personal_private"), true);
    assert.equal(app.firstHtml.includes("node pb:u_consultant"), true);
    assert.equal(app.firstHtml.includes("returned 200"), true);
    const me = await callApi("/v1/me");
    const meJson = JSON.parse(me.text);
    assert.equal(meJson.principal.id, "u_consultant");
    const own = await callApi("/v1/genui/plan", {
      method: "POST",
      body: JSON.stringify({ nodeId: "pb:u_consultant" }),
    });
    const ownJson = JSON.parse(own.text);
    assert.equal(own.status, 200);
    assert.equal(ownJson.title, "My Secondary");
    assert.equal(JSON.stringify(ownJson).includes("personal_private"), true);
    assert.equal(JSON.stringify(ownJson).includes("a_acme"), false);
    const otherOwner = await callApi("/v1/genui/plan", {
      method: "POST",
      persona: "ceo",
      body: JSON.stringify({ nodeId: "pb:u_consultant", tenantId: "tenant_other" }),
    });
    assert.equal(otherOwner.status, 404);
    assert.equal(otherOwner.text.includes("My Secondary"), false);
    assert.equal(otherOwner.text.includes("personal_private"), false);
    const plusMe = JSON.parse((await callApi("/v1/me", { persona: "consultant" })).text);
    assert.equal(plusMe.principal.id.startsWith("u_consultant_"), true);
    const plusPlan = await callApi("/v1/genui/plan", {
      method: "POST",
      persona: "consultant",
      body: JSON.stringify({ nodeId: `pb:${plusMe.principal.id}` }),
    });
    assert.equal(plusPlan.status, 404);
    const spoof = await fetch(`http://127.0.0.1:${app.port}/v1/me?tenant=tenant_other`, {
      headers: { cookie: app.cookie, "x-demo-persona": "ceo" },
    });
    assert.equal((await spoof.json()).principal.id, "u_consultant");
    const company = await fetch(`http://127.0.0.1:${app.port}/reconstruction/session`, {
      method: "POST",
      headers: { cookie: app.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: "scope=company&tenant=tenant_other",
      redirect: "manual",
    });
    assert.equal(company.status, 303);
    const companyPage = await fetch(`http://127.0.0.1:${app.port}/reconstruction/genui?tenant=tenant_other`, {
      headers: { cookie: app.cookie },
    });
    const companyHtml = await companyPage.text();
    assert.equal(companyHtml.includes("Accounts"), true);
    assert.equal(companyHtml.includes("personal_private"), false);
    assert.equal(companyHtml.includes("tenant_other"), false);
    const personal = await fetch(`http://127.0.0.1:${app.port}/reconstruction/session`, {
      method: "POST",
      headers: { cookie: app.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: "scope=personal",
      redirect: "manual",
    });
    assert.equal(personal.status, 303);
    const personalPage = await fetch(`http://127.0.0.1:${app.port}/reconstruction/genui`, {
      headers: { cookie: app.cookie },
    });
    const personalHtml = await personalPage.text();
    assert.equal(personalHtml.includes("Accounts"), false);
    assert.equal(personalHtml.includes("personal_private"), true);
    const other = await fetch(`http://127.0.0.1:${app.port}/reconstruction/session`, {
      method: "POST",
      headers: { cookie: app.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: "preset=person_b",
      redirect: "manual",
    });
    assert.equal(other.status, 303);
    const otherPage = await fetch(`http://127.0.0.1:${app.port}/reconstruction/genui`, {
      headers: { cookie: app.cookie },
    });
    const otherHtml = await otherPage.text();
    assert.equal(otherHtml.includes("u_ceo_"), true);
    assert.equal(otherHtml.includes("personal_private"), false);
    assert.equal(otherHtml.includes("returned 404"), true);
    assert.equal(otherHtml.includes("Accounts"), false);
    const rejected = await fetch(`http://127.0.0.1:${app.port}/reconstruction/genui/reject`, {
      method: "POST",
      headers: { cookie: app.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: "title=%3Cscript%3ESECRET_TOKEN_99%3C%2Fscript%3E",
    });
    const rejectedHtml = await rejected.text();
    assert.equal(rejected.status, 403);
    assert.equal(rejectedHtml.includes("SECRET_TOKEN_99"), false);
    assert.equal(rejectedHtml.includes("<script"), false);
    assert.equal(rejectedHtml.includes("Accounts"), false);
    await fetch(`http://127.0.0.1:${app.port}/reconstruction/session`, {
      method: "POST",
      headers: { cookie: app.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: "preset=person_a",
      redirect: "manual",
    });
    const obs = await fetch(`http://127.0.0.1:${app.port}/settings/observability`, {
      headers: { cookie: app.cookie },
    });
    const obsHtml = await obs.text();
    assert.equal(obs.status, 200);
    assert.equal(obsHtml.includes("Local preview · synthetic data"), true);
    assert.equal(obsHtml.includes("Consultant"), true);
    assert.equal(obsHtml.includes("Not permitted"), true);
    assert.equal(obsHtml.includes("Unknown"), true);
    assert.equal(obsHtml.includes("Unavailable"), true);
    assert.equal(obsHtml.includes("93%"), false);
    assert.equal(obsHtml.includes("Nova"), false);
    assert.equal(obsHtml.includes("Not connected"), true);
    assert.equal(obsHtml.includes('href="/settings"'), true);
    const saved = await fetch(`http://127.0.0.1:${app.port}/settings/observability/prefs`, {
      method: "POST",
      headers: { cookie: app.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: "lang=en",
    });
    const savedHtml = await saved.text();
    assert.equal(saved.status === 200 || saved.status === 400, true);
    assert.equal(savedHtml.includes("Saved through /v1/ux/prefs.") || savedHtml.includes("Save failed"), true);
    assert.equal(savedHtml.includes("workers.dev"), false);
    const blocked = await probeEgress();
    assert.equal(blocked.status, 403);
    assert.equal(blocked.text, "egress_denied");
  } finally {
    app.server.closeAllConnections?.();
    await new Promise((resolve) => app.server.close(resolve));
    await stopRecoveredApi();
  }
});
