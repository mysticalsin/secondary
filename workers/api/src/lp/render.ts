// The static page. One self-contained HTML document in the brand template: Carlito then Calibri, Mantu
// purple (#6600AE, #7F00DA), yellow (#F8F060) and dark (#1A0033), responsive, AA contrast, one idea per
// section. No external script, font, image or request of any kind. The only script is a tiny inline
// beacon that does nothing until the visitor accepts the consent banner, which declines by default.
// The pages worker allows the inline style and script by their hashes, so nothing else can run.

import { BRAND_NAME } from "./compose.ts";
import type { Brand, Contact, Lang, Prospect, Slots } from "./types.ts";

export const PALETTE = {
  purple: "#6600AE",
  violet: "#7F00DA",
  yellow: "#F8F060",
  dark: "#1A0033",
} as const;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const paragraphs = (s: string): string =>
  s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

const T: Record<
  Lang,
  {
    skip: string;
    why: string;
    work: string;
    for: (p: Prospect) => string;
    consent: string;
    decline: string;
    accept: string;
    privateNote: string;
    contact: string;
    subject: string;
    body: (c: Contact) => string;
  }
> = {
  en: {
    skip: "Skip to content",
    why: "Why us",
    work: "Our work",
    for: (p) => `Prepared for ${[p.firstName, p.role].filter(Boolean).join(", ")} at ${p.company}`,
    consent:
      "We count visits only if you agree: no cookies, no tracking across sites, no address stored.",
    decline: "Decline",
    accept: "Accept",
    privateNote: "This page is private to you and expires on its own.",
    contact: "Your contact",
    subject: "Conversation following your page",
    body: (c) =>
      `Hello ${c.name.split(/\s+/)[0] ?? ""},\n\nI read the page you prepared and would like to talk.\n\n`,
  },
  fr: {
    skip: "Aller au contenu",
    why: "Pourquoi nous",
    work: "Nos réalisations",
    for: (p) =>
      `Préparé pour ${[p.firstName, p.role].filter(Boolean).join(", ")} chez ${p.company}`,
    consent:
      "Nous ne comptons les visites que si vous acceptez : pas de cookie, pas de suivi entre sites, aucune adresse conservée.",
    decline: "Refuser",
    accept: "Accepter",
    privateNote: "Cette page vous est réservée et expire d'elle-même.",
    contact: "Votre contact",
    subject: "Échange suite à votre page",
    body: (c) =>
      `Bonjour ${c.name.split(/\s+/)[0] ?? ""},\n\nJ'ai lu la page que vous avez préparée et je souhaite en parler.\n\n`,
  },
};

const CSS = `
:root{--p:${PALETTE.purple};--v:${PALETTE.violet};--y:${PALETTE.yellow};--d:${PALETTE.dark};--ink:#1A0033;--mute:#4A3560;--line:#D9CCE6}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:Carlito,Calibri,"Segoe UI",Arial,sans-serif;font-size:1.125rem;line-height:1.6;color:var(--ink);background:#fff}
.skip{position:absolute;left:-999px;top:0;background:var(--y);color:var(--d);padding:.75rem 1rem;z-index:10}
.skip:focus{left:0}
a{color:var(--p)}
:focus-visible{outline:3px solid var(--v);outline-offset:3px}
.wrap{max-width:60rem;margin:0 auto;padding:0 1.25rem}
header.top{background:var(--d);color:#fff;padding:1rem 0}
.brand{font-weight:700;letter-spacing:.04em;font-size:1.25rem}
.brand::after{content:"";display:block;width:2.5rem;height:.25rem;background:var(--y);margin-top:.25rem}
.hero{background:var(--d);color:#fff;padding:3rem 0 4rem}
.hero h1{font-size:clamp(2rem,6vw,3.25rem);line-height:1.1;margin:0 0 1rem;max-width:20ch}
.hero .for{color:#E6DAF5;margin:0}
section{padding:3rem 0}
section h2{font-size:clamp(1.5rem,4vw,2rem);color:var(--p);margin:0 0 1rem;line-height:1.2}
section p{margin:0 0 1rem;max-width:42rem}
.alt{background:#F6F1FA}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1.25rem;margin-top:1.5rem}
.card{border:1px solid var(--line);border-top:.3rem solid var(--v);background:#fff;padding:1.25rem;border-radius:.25rem}
.card h3{margin:0 0 .5rem;font-size:1.2rem;color:var(--d)}
.card p{margin:0;color:var(--mute);font-size:1rem}
.card img{display:block;width:100%;height:9rem;object-fit:cover;margin:0 0 1rem}
.cta{background:var(--y);color:var(--d)}
.cta h2{color:var(--d)}
.btn{display:inline-block;background:var(--d);color:var(--y);padding:.9rem 1.5rem;font-weight:700;text-decoration:none;border-radius:.25rem}
.btn:hover{background:var(--p)}
footer{background:var(--d);color:#E6DAF5;padding:2rem 0;font-size:1rem}
footer a{color:#fff}
footer p{margin:0 0 .5rem}
.consent{position:fixed;left:0;right:0;bottom:0;background:var(--d);color:#fff;padding:1rem 1.25rem;display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between;border-top:.25rem solid var(--y);z-index:20}
.consent[hidden]{display:none}
.consent p{margin:0;max-width:40rem;font-size:1rem}
.consent button{font:inherit;font-weight:700;padding:.6rem 1.25rem;border-radius:.25rem;cursor:pointer;border:2px solid #fff;background:transparent;color:#fff}
.consent button[data-yes]{background:var(--y);color:var(--d);border-color:var(--y)}
@media (prefers-reduced-motion:no-preference){.btn{transition:background .15s}}
@media print{.consent,.skip{display:none}}
`;

/** The inline beacon. It runs only after "Accept", sends counts and nothing else, and sets nothing. */
export const BEACON = `(function(){var k="lpc",s=null,c=document.getElementById("consent");if(!c)return;
try{s=sessionStorage.getItem(k)}catch(e){}
var p=location.pathname.replace(/\\/+$/,"")+"/e";
function send(o){o.c=true;try{navigator.sendBeacon(p,JSON.stringify(o))}catch(e){}}
function start(){send({k:"view"});var d={25:0,50:0,75:0,100:0};
function sc(){var h=document.documentElement,t=(h.scrollTop+window.innerHeight)/h.scrollHeight*100;
for(var b in d)if(!d[b]&&t>=+b){d[b]=1;send({k:"scroll",b:+b})}}
addEventListener("scroll",sc,{passive:true});sc();
var a=document.querySelector("[data-cta]");if(a)a.addEventListener("click",function(){send({k:"cta"})})}
function set(v){try{sessionStorage.setItem(k,v)}catch(e){}c.hidden=true;if(v==="1")start()}
if(s==="1")start();else if(s!=="0"){c.hidden=false;
c.querySelector("[data-yes]").addEventListener("click",function(){set("1")});
c.querySelector("[data-no]").addEventListener("click",function(){set("0")})}})();`;

/** An image is allowed only as a small inline data URL, as it comes from a brain page. */
export const IMAGE_OK = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]{16,150000}$/;

/**
 * Everything a template needs, and nothing else: data in, one HTML string out. The web template
 * (apps/web/src/lp-template) implements the same signature. Rules every template keeps:
 *  - static HTML, no external request of any kind; the only script is one inline consent and beacon
 *    script, allowed by its hash (the pages worker computes it), only when `mode` is "published"
 *  - an image is either `/p/<slug>/i/<n>` (an asset copied into the pages bucket at publish time) or,
 *    in the review preview only, a small data URL. Any other value is dropped, never a brain URL.
 */
export interface LandingRenderData {
  brand: Brand;
  lang: Lang;
  prospect: Prospect;
  slots: Slots;
  references: readonly { title: string; summary: string; image?: string }[];
  contact: Contact;
  mode: "preview" | "published";
}

/** The path a published image is served from by the pages worker. */
export const PUBLISHED_IMAGE = /^\/p\/[0-9a-f]{32}\/i\/[0-5]$/;

const imageSrc = (img: string | undefined, mode: LandingRenderData["mode"]): string | null =>
  !img
    ? null
    : mode === "published"
      ? PUBLISHED_IMAGE.test(img)
        ? img
        : null
      : IMAGE_OK.test(img)
        ? img
        : null;

const card = (
  r: LandingRenderData["references"][number],
  mode: LandingRenderData["mode"],
): string => {
  const src = imageSrc(r.image, mode);
  return `<article class="card">${src ? `<img src="${esc(src)}" alt="">` : ""}<h3>${esc(r.title)}</h3><p>${esc(r.summary)}</p></article>`;
};

export function renderLandingPage(r: LandingRenderData): string {
  const o = { beacon: r.mode === "published" };
  const t = T[r.lang];
  const brand = BRAND_NAME[r.brand];
  const mail = `mailto:${r.contact.email}?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(t.body(r.contact))}`;
  const html = `<!doctype html>
<html lang="${r.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>${esc(r.slots.hero)}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">${t.skip}</a>
<header class="top"><div class="wrap"><span class="brand">${esc(brand)}</span></div></header>
<main id="main">
<div class="hero"><div class="wrap"><h1>${esc(r.slots.hero)}</h1><p class="for">${esc(t.for(r.prospect))}</p></div></div>
<section><div class="wrap">${paragraphs(r.slots.intro)}</div></section>
<section class="alt"><div class="wrap"><h2>${t.why}</h2>${paragraphs(r.slots.whyUs)}</div></section>
${
  r.references.length
    ? `<section><div class="wrap"><h2>${t.work}</h2>${paragraphs(r.slots.caseStudyIntro)}<div class="cards">${r.references.map((x) => card(x, r.mode)).join("")}</div></div></section>`
    : ""
}
<section class="cta"><div class="wrap"><h2>${esc(r.slots.cta)}</h2><p><a class="btn" data-cta href="${esc(mail)}">${esc(r.contact.name)}</a></p></div></section>
</main>
<footer><div class="wrap"><p>${esc(t.contact)}: ${esc(r.contact.name)}, <a href="mailto:${esc(r.contact.email)}">${esc(r.contact.email)}</a></p><p>${esc(t.privateNote)}</p></div></footer>
<div id="consent" class="consent" role="dialog" aria-label="${esc(t.consent)}" hidden><p>${esc(t.consent)}</p><div><button type="button" data-no>${t.decline}</button> <button type="button" data-yes>${t.accept}</button></div></div>
${o.beacon ? `<script>${BEACON}</script>` : ""}
</body>
</html>`;
  return html;
}
