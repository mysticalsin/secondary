import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { SCOPE_LABELS, type Scope } from "./config.ts";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
:root{--purple:#6600AE;--yellow:#F8F060;--ink:#1b1230;--muted:#5d5470;--line:#e4dcef;--bg:#f7f4fb}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Carlito,Calibri,"Segoe UI",Helvetica,Arial,sans-serif;font-size:17px;line-height:1.45}
header{background:var(--purple);padding:18px 24px}
.wordmark{color:#fff;font-size:34px;font-weight:700;letter-spacing:-.02em;text-transform:lowercase}
.wordmark i{display:inline-block;width:.34em;height:.34em;border-radius:50%;background:var(--yellow);margin-left:.08em}
main{max-width:560px;margin:28px auto;padding:0 16px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px 24px 20px}
h1{font-size:25px;line-height:1.2;margin:0 0 6px}
.sub{color:var(--muted);margin:0 0 18px}
dl{margin:0 0 16px;display:grid;grid-template-columns:auto 1fr;gap:6px 14px}
dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere;font-weight:700}
.warn{background:#fff7d6;border-left:5px solid var(--yellow);padding:10px 12px;margin:0 0 16px;border-radius:6px}
ul{margin:0 0 16px;padding:0;list-style:none}
li{padding:9px 0;border-top:1px solid var(--line)}
li:last-child{border-bottom:1px solid var(--line)}
label{display:flex;gap:10px;align-items:flex-start}
input[type=checkbox]{margin-top:5px;accent-color:var(--purple);width:18px;height:18px}
code{font-size:14px;color:var(--purple)}
.never{color:var(--muted);font-size:15px;margin:0 0 20px}
.row{display:flex;gap:12px;flex-wrap:wrap}
button{font:inherit;font-weight:700;border-radius:10px;padding:11px 22px;cursor:pointer;border:2px solid var(--purple)}
.allow{background:var(--yellow);color:var(--purple);border-color:var(--yellow)}
.allow:hover,.allow:focus{border-color:var(--purple)}
.deny{background:#fff;color:var(--purple)}
button:focus-visible{outline:3px solid var(--purple);outline-offset:2px}
`;

const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export function pageHeaders(): Headers {
  return new Headers({
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": CSP,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
}

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><header><span class="wordmark">mantu<i></i></span></header><main>${body}</main></body></html>`;
}

export interface ConsentView {
  details: ConsentDescription;
  email: string;
  /** Scopes the client asked for that this server can grant. */
  scopes: Scope[];
  handle: string;
}

export function consentPage(v: ConsentView): string {
  const { details } = v;
  const origin = details.clientDomain
    ? `<dt>Published by</dt><dd>${escapeHtml(details.clientDomain)}</dd>`
    : `<dt>Registration</dt><dd>Self-registered, name not verified</dd>`;
  const scopeRows = v.scopes
    .map((s) =>
      s === "secondary.read"
        ? `<li><input type="hidden" name="scope" value="${escapeHtml(s)}"><code>${escapeHtml(s)}</code> (required)<br>${escapeHtml(SCOPE_LABELS[s])}</li>`
        : `<li><label><input type="checkbox" name="scope" value="${escapeHtml(s)}" checked><span><code>${escapeHtml(s)}</code><br>${escapeHtml(SCOPE_LABELS[s])}</span></label></li>`,
    )
    .join("");
  const loopback = details.redirectIsLoopback
    ? `<p class="warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>`
    : "";
  return shell(
    `Authorize ${details.clientName}`,
    `<div class="card"><h1>Allow ${escapeHtml(details.clientName)} to use Secondary?</h1>
<p class="sub">Signed in as ${escapeHtml(v.email)}</p>
<dl><dt>Application</dt><dd>${escapeHtml(details.clientName)}</dd>${origin}<dt>Returns to</dt><dd>${escapeHtml(details.redirectHost)}</dd></dl>
${loopback}
<form method="post"><input type="hidden" name="handle" value="${escapeHtml(v.handle)}">
<ul>${scopeRows}</ul>
<p class="never">It can never approve, delete or change membership. It sees only what your role already allows, and your Personal Brain is visible to you alone.</p>
<div class="row"><button class="allow" name="decision" value="approve">Allow</button><button class="deny" name="decision" value="deny">Deny</button></div></form></div>`,
  );
}

export function errorPage(title: string, message: string): string {
  return shell(
    title,
    `<div class="card"><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(message)}</p></div>`,
  );
}
