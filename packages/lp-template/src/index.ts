// Landing page template: data in, HTML string out. No React, no DOM, no imports: the web app (editor
// preview) and the API worker (stored review rendering and the published page) both render with this
// one file. One self-contained document: one inline <style>, system fonts (Carlito, then Calibri, then
// the platform UI font), no external request of any kind.
//
//   renderLandingPage(data, { mode: "published" })  the page the pages worker serves: the consent banner
//       (hidden until the script shows it, declines by default) and the one inline beacon script; images
//       only as `/p/<slug>/i/<n>`, copied into the pages bucket at publish time
//   renderLandingPage(data, { mode: "public" })     the same page without any script (review, preview);
//       images only as small inline data: URLs
//   renderLandingPage(data, { mode: "edit", ... })  the editor preview: slots get data-slot hooks
//   renderLandingPage(data, { mode: "thumb" })      an inert render for list thumbnails
//
// CSP the page needs: `style-src` by hash or by `nonce` (pass `nonce` and it is put on the <style>),
// `script-src` by the hash of the beacon (published only), `img-src 'self'`, `connect-src 'self'`.
// There is no inline style attribute and no event-handler attribute, so nothing needs 'unsafe-inline'.

export type SlotId = "hero" | "intro" | "whyUs" | "caseStudyIntro" | "cta";

export interface TemplateReference {
  title: string;
  summary: string;
  image?: string;
  /** `named`: a CustomerPermission covers this item for landing pages. */
  permission: "named" | "generalised-only";
  generalisedTitle?: string;
  /** Shown only when `permission` is `named` (the customer permission covers the figure too). */
  metric?: { value: string; label: string };
}

export interface TemplateData {
  brand: "amaris" | "mantu";
  lang: "fr" | "en";
  prospect: { firstName?: string; role: string; company: string };
  slots: Record<SlotId, string>;
  references: TemplateReference[];
  contact: { name: string; title?: string; email: string };
  /** ISO date. Shown in the footer and the header strip when present. */
  expiresAt?: string;
}

export const PALETTE = {
  purple: "#6600AE",
  violet: "#7F00DA",
  yellow: "#F8F060",
  dark: "#1A0033",
} as const;

export interface RenderOptions {
  mode?: "published" | "public" | "edit" | "thumb";
  /** CSP nonce for the inline style. */
  nonce?: string;
  /** Edit mode: slots with an open check. */
  flagged?: readonly string[];
  /** Edit mode: words for the editing hooks, in the editor's language. */
  labels?: { edit: string; slots: Record<SlotId, string> };
}

export interface Parts {
  title: string;
  css: string;
  body: string;
  /** The inline beacon, `published` mode only. The page has no other script. */
  script?: string;
}

/**
 * The inline beacon. It runs only after "Accept", sends counts and nothing else, and sets nothing: the
 * choice is kept in sessionStorage (no cookie, no localStorage) and every event carries `c:true`, the
 * consent flag the pages worker requires before it counts anything.
 */
export const BEACON = `(function(){var k="lpc",s=null,c=document.getElementById("consent");if(!c)return;
try{s=sessionStorage.getItem(k)}catch(e){}
var p=location.pathname.replace(/\\/+$/,"")+"/e";
function send(o){o.c=true;try{navigator.sendBeacon(p,JSON.stringify(o))}catch(e){}}
function start(){send({k:"view"});var d={25:0,50:0,75:0,100:0};
function sc(){var h=document.documentElement,t=(h.scrollTop+window.innerHeight)/h.scrollHeight*100;
for(var b in d)if(!d[b]&&t>=+b){d[b]=1;send({k:"scroll",b:+b})}}
addEventListener("scroll",sc,{passive:true});sc();
document.querySelectorAll("[data-cta]").forEach(function(a){a.addEventListener("click",function(){send({k:"cta"})})})}
function set(v){try{sessionStorage.setItem(k,v)}catch(e){}c.hidden=true;if(v==="1")start()}
if(s==="1")start();else if(s!=="0"){c.hidden=false;
c.querySelector("[data-yes]").addEventListener("click",function(){set("1")});
c.querySelector("[data-no]").addEventListener("click",function(){set("0")})}})();`;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A small inline image as it comes from a brain page. SVG is for the editor's own mock visuals only. */
export const IMAGE_OK = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]{16,150000}$/;
const SVG_OK = /^data:image\/svg\+xml[;,][^\s"'<>]{1,60000}$/;
/** The path a published image is served from by the pages worker. */
export const PUBLISHED_IMAGE = /^\/p\/[0-9a-f]{32}\/i\/[0-5]$/;

/** An image is `/p/<slug>/i/<n>` on a published page and an inline data: image anywhere else. Never a URL. */
const imageOf = (u: string | undefined, published: boolean): string | null =>
  !u
    ? null
    : published
      ? PUBLISHED_IMAGE.test(u)
        ? u
        : null
      : IMAGE_OK.test(u) || SVG_OK.test(u)
        ? u
        : null;

/** Plain text of a slot: a line break stays one, a blank line is a paragraph break. Already escaped. */
const lines = (s: string): string => s.replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>");

const BRAND = { amaris: "Amaris", mantu: "Mantu" } as const;

interface Copy {
  hi: (name: string | undefined, brand: string, company: string) => string;
  see: string;
  write: (name: string) => string;
  proofProjects: (n: number) => [string, string];
  proofReviewed: [string, string];
  proofClose: (date: string) => [string, string];
  howTitle: string;
  steps: [string, string][];
  private: string;
  expires: (date: string) => string;
  footer: string;
  prepared: (name: string) => string;
  fallback: string;
  skip: string;
  consent: string;
  decline: string;
  accept: string;
  subject: string;
  body: (first: string) => string;
}

const COPY: Record<"fr" | "en", Copy> = {
  en: {
    hi: (n, b, c) => `${n ? `Hello ${n}.` : "Hello."} Here is what ${b} would build for ${c}.`,
    see: "See related work",
    write: (n) => `Write to ${n}`,
    proofProjects: (n) => [String(n), n === 1 ? "related project" : "related projects"],
    proofReviewed: ["Reviewed", "by a second person before it reached you"],
    proofClose: (d) =>
      d ? [d, "this private page closes by itself"] : ["Private", "this page is for you alone"],
    howTitle: "How we work",
    steps: [
      [
        "We listen first",
        "A short conversation to pin down the problem and what a good result looks like.",
      ],
      [
        "We build in small steps",
        "You see working results every few weeks, not one big reveal at the end.",
      ],
      [
        "We hand over the keys",
        "Your teams run what we build, with the skills and notes to change it.",
      ],
    ],
    private: "Client name kept private",
    expires: (d) => `Open until ${d}`,
    footer: "Made for one person.",
    prepared: (n) => `Prepared for ${n}`,
    fallback: "A client project",
    skip: "Skip to content",
    consent:
      "We count visits only if you agree: no cookies, no tracking across sites, no address stored.",
    decline: "Decline",
    accept: "Accept",
    subject: "Conversation following your page",
    body: (n) => `Hello ${n},\n\nI read the page you prepared and would like to talk.\n\n`,
  },
  fr: {
    hi: (n, b, c) =>
      `${n ? `Bonjour ${n}.` : "Bonjour."} Voici ce qu${/^[AEIOUH]/i.test(b) ? "'" : "e "}${b} construirait pour ${c}.`,
    see: "Voir des travaux proches",
    write: (n) => `Écrire à ${n}`,
    proofProjects: (n) => [String(n), n === 1 ? "projet proche" : "projets proches"],
    proofReviewed: ["Relue", "par une deuxième personne avant de vous parvenir"],
    proofClose: (d) =>
      d
        ? [d, "cette page privée se ferme d'elle-même"]
        : ["Privée", "cette page n'est que pour vous"],
    howTitle: "Notre façon de travailler",
    steps: [
      [
        "On écoute d'abord",
        "Un court échange pour cerner le problème et ce que serait un bon résultat.",
      ],
      [
        "On avance par petites étapes",
        "Vous voyez des résultats qui fonctionnent toutes les quelques semaines.",
      ],
      [
        "On vous remet les clés",
        "Vos équipes font tourner ce que nous construisons, avec les notes pour le faire évoluer.",
      ],
    ],
    private: "Nom du client gardé confidentiel",
    expires: (d) => `Ouverte jusqu'au ${d}`,
    footer: "Faite pour une seule personne.",
    prepared: (n) => `Préparée pour ${n}`,
    fallback: "Un projet client",
    skip: "Aller au contenu",
    consent:
      "Nous ne comptons les visites que si vous acceptez : pas de cookie, pas de suivi entre sites, aucune adresse conservée.",
    decline: "Refuser",
    accept: "Accepter",
    subject: "Échange suite à votre page",
    body: (n) =>
      `Bonjour ${n},\n\nJ'ai lu la page que vous avez préparée et je souhaite en parler.\n\n`,
  },
};

const CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;font-family:Carlito,Calibri,"Segoe UI",system-ui,-apple-system,sans-serif;font-size:19px;line-height:1.55;color:#1A0033;background:#fff;-webkit-font-smoothing:antialiased}
h1,h2,h3,p,ul,ol,figure{margin:0}
ul,ol{padding:0;list-style:none}
a{color:inherit}
img{display:block;max-width:100%}
.wrap{max-width:1120px;margin:0 auto;padding:0 clamp(20px,5vw,64px)}
.band{background:linear-gradient(135deg,#1A0033 0%,#6600AE 58%,#7F00DA 100%);color:#fff;position:relative;overflow:hidden}
.band::before{content:"";position:absolute;inset:0;background:radial-gradient(52% 70% at 88% 0%,rgba(248,240,96,.17),transparent 62%),radial-gradient(40% 60% at 0% 100%,rgba(127,0,218,.55),transparent 70%);pointer-events:none}
.band>*{position:relative;z-index:1}
.band::after{content:"";position:absolute;right:-6%;top:50%;width:560px;height:560px;transform:translateY(-50%);border-radius:50%;background:repeating-radial-gradient(circle,rgba(255,255,255,.11) 0 1.5px,transparent 1.5px 36px);pointer-events:none}
.cta.band::after{display:none}
.mantu .band{background:linear-gradient(160deg,#1A0033 0%,#2d0a54 50%,#6600AE 100%)}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-top:28px}
.mark{font-weight:700;font-size:24px;letter-spacing:-.02em}
.mantu .mark{color:#F8F060}
.for{font-size:15px;padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.14);color:#fff;white-space:nowrap}
.hero{padding-top:clamp(56px,9vw,112px);padding-bottom:clamp(64px,10vw,128px);display:flex;flex-direction:column;gap:28px}
.hi{font-size:clamp(17px,1.6vw,20px);color:#e9d8ff;max-width:46ch}
h1{font-size:clamp(40px,6.4vw,86px);line-height:1.02;font-weight:700;letter-spacing:-.035em;max-width:16ch;text-wrap:balance}
.intro{font-size:clamp(19px,2vw,24px);line-height:1.45;color:#f3e8ff;max-width:46ch}
.actions{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:8px}
.btn{display:inline-flex;align-items:center;gap:10px;background:#F8F060;color:#1A0033;font-weight:700;font-size:18px;padding:15px 30px;border-radius:999px;text-decoration:none;box-shadow:0 8px 24px rgba(26,0,51,.28);transition:transform .2s ease,box-shadow .2s ease}
.btn:hover{transform:translateY(-1px);box-shadow:0 12px 30px rgba(26,0,51,.34)}
.btn:focus-visible,.ghost:focus-visible,.sticky:focus-visible{outline:3px solid #fff;outline-offset:3px}
.ghost{color:#fff;font-weight:700;font-size:18px;padding:15px 8px;text-decoration:none;border-bottom:2px solid rgba(248,240,96,.9)}
.proof{border-bottom:1px solid #eadcf7}
.proof ul{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.proof li{padding:30px 28px 30px 0;display:flex;flex-direction:column;gap:2px}
.proof li+li{padding-left:28px;border-left:1px solid #eadcf7}
.proof strong{font-size:clamp(26px,3.2vw,40px);line-height:1.1;letter-spacing:-.02em;color:#6600AE}
.proof span{font-size:16px;color:#4a3a5c}
.sec{padding:clamp(56px,8vw,104px) 0}
h2{font-size:clamp(28px,3.8vw,48px);line-height:1.08;font-weight:700;letter-spacing:-.025em;text-wrap:balance}
.why p{border-left:6px solid #F8F060;padding-left:clamp(18px,3vw,32px);font-size:clamp(22px,2.7vw,34px);line-height:1.32;font-weight:700;letter-spacing:-.015em;max-width:30ch;text-wrap:pretty}
.how{background:#f7f0ff}
.how h2{margin-bottom:36px}
.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;counter-reset:s}
.steps li{background:#fff;border-radius:20px;padding:28px;display:flex;flex-direction:column;gap:10px;counter-increment:s;box-shadow:0 1px 0 #eadcf7}
.steps li::before{content:counter(s);width:36px;height:36px;border-radius:50%;background:#1A0033;color:#F8F060;font-weight:700;display:grid;place-items:center}
.steps h3{font-size:22px;line-height:1.2;letter-spacing:-.01em}
.steps p{font-size:17px;color:#4a3a5c}
.work h2{margin-bottom:40px;max-width:20ch}
.cases{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}
.case{display:flex;flex-direction:column;border-radius:24px;overflow:hidden;background:#fff;border:1px solid #eadcf7;box-shadow:0 18px 40px -24px rgba(26,0,51,.35)}
.case:first-child:nth-last-child(n+3){grid-column:1/-1;flex-direction:row}
.case:first-child:nth-last-child(n+3) .pic{flex:1.25;aspect-ratio:auto;min-height:300px}
.case:first-child:nth-last-child(n+3) .txt{flex:1;justify-content:center}
.pic{aspect-ratio:16/10;background:repeating-radial-gradient(circle at 82% 18%,rgba(255,255,255,.13) 0 1.5px,transparent 1.5px 30px),linear-gradient(135deg,#1A0033,#6600AE 60%,#7F00DA);overflow:hidden}
.pic img{width:100%;height:100%;object-fit:cover}
.txt{padding:26px 28px 30px;display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.case h3{font-size:24px;line-height:1.18;letter-spacing:-.015em}
.case p{font-size:17px;color:#4a3a5c}
.metric{display:inline-flex;gap:8px;align-items:baseline;background:#F8F060;color:#1A0033;border-radius:999px;padding:5px 14px;font-size:15px}
.metric strong{font-size:19px}
.priv{display:inline-flex;gap:7px;align-items:center;background:#f3e8ff;color:#4a1a7a;border-radius:999px;padding:5px 12px;font-size:14px;font-weight:700}
.priv svg{width:14px;height:14px}
.cta{padding:clamp(56px,8vw,104px) 0}
.cta .wrap{display:flex;flex-direction:column;gap:32px;align-items:flex-start}
.cta p{font-size:clamp(26px,3.6vw,44px);line-height:1.12;font-weight:700;letter-spacing:-.025em;max-width:22ch;text-wrap:balance}
.foot{background:#1A0033;color:#e2c8ff;font-size:15px;padding:22px 0 26px}
.foot .wrap{display:flex;justify-content:space-between;gap:12px 24px;flex-wrap:wrap}
.foot strong{color:#fff}
.sticky{display:none}
.skip{position:absolute;left:-999px;top:0;background:#F8F060;color:#1A0033;padding:12px 16px;z-index:30;font-weight:700}
.skip:focus{left:0}
.consent{position:fixed;left:0;right:0;bottom:0;background:#1A0033;color:#fff;padding:16px clamp(16px,4vw,32px);display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;border-top:4px solid #F8F060;z-index:40;font-size:16px;line-height:1.4}
.consent[hidden]{display:none}
.consent p{max-width:60ch}
.consent button{font:inherit;font-weight:700;padding:10px 20px;border-radius:999px;cursor:pointer;border:2px solid #fff;background:transparent;color:#fff}
.consent button[data-yes]{background:#F8F060;color:#1A0033;border-color:#F8F060}
.consent button:focus-visible{outline:3px solid #7F00DA;outline-offset:2px}
@media print{.consent,.skip,.sticky{display:none}}
@media (max-width:860px){
.steps{grid-template-columns:minmax(0,1fr)}
.cases{grid-template-columns:minmax(0,1fr)}
.case:first-child:nth-last-child(n+3){flex-direction:column}
.case:first-child:nth-last-child(n+3) .pic{aspect-ratio:16/10;min-height:0}
}
@media (max-width:720px){
body{font-size:18px;padding-bottom:84px}
.for{display:none}
.band::after{display:none}
.proof ul{grid-template-columns:minmax(0,1fr)}
.proof li,.proof li+li{padding:18px 0;border-left:0}
.proof li+li{border-top:1px solid #eadcf7}
.btn{width:100%;justify-content:center}
.actions{width:100%}
.sticky{display:flex;position:fixed;left:12px;right:12px;bottom:12px;z-index:5;justify-content:center;background:#F8F060;color:#1A0033;font-weight:700;font-size:18px;padding:15px 20px;border-radius:999px;text-decoration:none;box-shadow:0 12px 30px rgba(26,0,51,.4)}
}
@supports (animation-timeline:view()){
.rv{animation:rv linear both;animation-timeline:view();animation-range:entry 0% entry 45%}
@keyframes rv{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
}
@media (prefers-reduced-motion:reduce){
.rv{animation:none}
html{scroll-behavior:auto}
.btn{transition:none}
}
`;

const EDIT_CSS = `
.rv{animation:none}
.sticky{display:none!important}
body{padding-bottom:0!important}
[data-slot]{cursor:text;border-radius:8px;position:relative;display:inline-block;max-width:100%}
[data-slot]:hover,[data-slot]:focus-visible{outline:2px solid #F8F060;outline-offset:5px;box-shadow:0 0 0 7px rgba(26,0,51,.9)}
[data-slot]:hover::after,[data-slot]:focus-visible::after{content:attr(data-edit);position:absolute;right:-6px;top:-30px;font:700 12px/1 Carlito,Calibri,system-ui,sans-serif;letter-spacing:.02em;background:#1A0033;color:#F8F060;border:1px solid #F8F060;border-radius:999px;padding:5px 10px;white-space:nowrap;pointer-events:none;z-index:9}
[data-slot][contenteditable]{outline:2px solid #F8F060;outline-offset:5px;box-shadow:0 0 0 7px rgba(26,0,51,.9);cursor:text}
[data-slot][contenteditable]::after{display:none}
[data-slot][data-flag]{outline:2px dashed #ff6b8a;outline-offset:5px}
.sec [data-slot]{width:100%}
[data-slot]{white-space:pre-line}
`;

function dateOf(iso: string, lang: "fr" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(d);
}

const LOCK =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';

export function renderLandingParts(d: TemplateData, o: RenderOptions = {}): Parts {
  const mode = o.mode ?? "public";
  const c = COPY[d.lang];
  const brand = BRAND[d.brand];
  const edit = mode === "edit";
  const published = mode === "published";
  const flagged = new Set(o.flagged ?? []);
  const slot = (id: SlotId): string => {
    const text = edit ? esc(d.slots[id]) : lines(esc(d.slots[id]));
    if (!edit) return text;
    const label = o.labels?.slots[id] ?? id;
    const hook = `${o.labels?.edit ?? "Edit"} ${label}`;
    return `<span data-slot="${id}" data-edit="${esc(o.labels?.edit ?? "Edit")}" data-name="${esc(label)}" role="button" tabindex="0" aria-label="${esc(`${hook}: ${d.slots[id]}`)}"${flagged.has(id) ? ' data-flag="1"' : ""}>${text || "&nbsp;"}</span>`;
  };
  const name = d.prospect.firstName?.trim() || undefined;
  // A pre-filled message the visitor sends themselves; the page sends nothing.
  const cta = esc(
    `mailto:${d.contact.email}?subject=${encodeURIComponent(c.subject)}&body=${encodeURIComponent(c.body(d.contact.name.split(/\s+/)[0] ?? ""))}`,
  );
  const rv = mode === "public" || published ? " rv" : "";

  const cards = d.references
    .map((r) => {
      const named = r.permission === "named";
      const title = named ? r.title : (r.generalisedTitle ?? c.fallback);
      const img = imageOf(r.image, published);
      const metric =
        named && r.metric
          ? `<span class="metric"><strong>${esc(r.metric.value)}</strong> ${esc(r.metric.label)}</span>`
          : "";
      const priv = named ? "" : `<span class="priv">${LOCK}${esc(c.private)}</span>`;
      return `<li class="case${rv}"><div class="pic">${img ? `<img src="${esc(img)}" loading="lazy" alt="">` : ""}</div><div class="txt">${metric}${priv}<h3>${esc(title)}</h3><p>${esc(r.summary)}</p></div></li>`;
    })
    .join("");
  const hasRefs = d.references.length > 0;
  const [pn, pl] = c.proofProjects(d.references.length);
  const steps = c.steps
    .map(([h, p]) => `<li class="${rv.trim()}"><h3>${esc(h)}</h3><p>${esc(p)}</p></li>`)
    .join("");
  const who = name ?? d.prospect.role;
  const until = d.expiresAt ? dateOf(d.expiresAt, d.lang) : "";
  const proofClose = c.proofClose(until);

  const live = mode === "public" || published;
  const body = `<div class="${d.brand}">
${live ? `<a class="skip" href="#main">${esc(c.skip)}</a>` : ""}<header class="band"><div class="wrap top"><span class="mark">${brand}</span><span class="for">${esc(c.prepared(who))}</span></div>
<div class="wrap hero"><p class="hi">${esc(c.hi(name, brand, d.prospect.company))}</p>
<h1>${slot("hero")}</h1>
<p class="intro">${slot("intro")}</p>
<div class="actions"><a class="btn" data-cta href="${cta}">${esc(c.write(d.contact.name))}</a>${hasRefs ? `<a class="ghost" href="#work">${esc(c.see)}</a>` : ""}</div></div></header>
<main id="main">
<section class="proof" aria-label="${esc(brand)}"><div class="wrap"><ul>
${hasRefs ? `<li class="${rv.trim()}"><strong>${esc(pn)}</strong><span>${esc(pl)}</span></li>` : ""}
<li class="${rv.trim()}"><strong>${esc(c.proofReviewed[0])}</strong><span>${esc(c.proofReviewed[1])}</span></li>
<li class="${rv.trim()}"><strong>${esc(proofClose[0])}</strong><span>${esc(proofClose[1])}</span></li></ul></div></section>
<section class="sec why"><div class="wrap"><p class="${rv.trim()}">${slot("whyUs")}</p></div></section>
<section class="sec how" aria-labelledby="how"><div class="wrap"><h2 id="how" class="${rv.trim()}">${esc(c.howTitle)}</h2><ol class="steps">${steps}</ol></div></section>
${hasRefs || edit ? `<section class="sec work" id="work" aria-labelledby="work-h"><div class="wrap"><h2 id="work-h" class="${rv.trim()}">${slot("caseStudyIntro")}</h2><ul class="cases">${cards}</ul></div></section>` : ""}
<section class="band cta" aria-label="${esc(c.write(d.contact.name))}"><div class="wrap"><p>${slot("cta")}</p><a class="btn" data-cta href="${cta}">${esc(c.write(d.contact.name))}</a></div></section>
</main>
<footer class="foot"><div class="wrap"><span><strong>${esc(d.contact.name)}</strong>${d.contact.title ? `, ${esc(d.contact.title)}` : ""}</span><span>${esc(c.footer)}${until ? ` ${esc(c.expires(until))}.` : ""}</span></div></footer>
<a class="sticky" data-cta href="${cta}">${esc(c.write(d.contact.name))}</a>
${live ? `<div id="consent" class="consent" role="dialog" aria-label="${esc(c.consent)}" hidden><p>${esc(c.consent)}</p><div><button type="button" data-no>${esc(c.decline)}</button> <button type="button" data-yes>${esc(c.accept)}</button></div></div>` : ""}
</div>`;

  return {
    title: `${brand}: ${d.slots.hero.slice(0, 80)}`,
    css: CSS + (edit ? EDIT_CSS : ""),
    body: mode === "thumb" ? body.replace("<div class=", "<div inert class=") : body,
    ...(published ? { script: BEACON } : {}),
  };
}

/** The complete document. Public pages add `noindex`, so a private link stays out of search results. */
export function renderLandingPage(d: TemplateData, o: RenderOptions = {}): string {
  const { title, css, body, script } = renderLandingParts(d, o);
  const nonce = o.nonce ? ` nonce="${esc(o.nonce)}"` : "";
  return `<!doctype html><html lang="${d.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style${nonce}>${css}</style></head><body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;
}
