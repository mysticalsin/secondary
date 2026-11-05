import { renderLandingParts } from "@secondary/lp-template";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../../i18n";
import type { LandingDraft, LpLang, LpReference, SlotId } from "../../../lp/types";
import { SLOT_IDS } from "../../../lp/types";
import "./lp.css";

export type Device = "desktop" | "phone";
export const DEVICE_W: Record<Device, number> = { desktop: 1200, phone: 390 };

export type PageData = Pick<
  LandingDraft,
  "brand" | "lang" | "prospect" | "slots" | "references" | "contact"
> & { expiresAt?: string };

const FALLBACK: Record<LpLang, string> = { en: "A client project", fr: "Un projet client" };

/** The title the visitor sees. Without permission on record the client stays hidden. */
export function shownTitle(r: LpReference, lang: LpLang): string {
  return r.permission === "named" ? r.title : (r.generalisedTitle ?? FALLBACK[lang]);
}

const applied = new WeakMap<Document, string>();

/**
 * Puts the template's CSS on a frame's document. The app's CSP allows no inline style (`style-src 'self'`),
 * and a frame made from `srcdoc` inherits it, so a `<style>` element would be dropped. A constructed
 * stylesheet is not inline style: it is exempt, and needs neither a nonce nor 'unsafe-inline'. Where a
 * browser has none (or a test runs without one) a `<style>` element is the fallback.
 */
export function setFrameCss(doc: Document, css: string): void {
  if (applied.get(doc) === css) return;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (win && "adoptedStyleSheets" in doc && typeof win.CSSStyleSheet === "function") {
    try {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(css);
      doc.adoptedStyleSheets = [sheet];
      applied.set(doc, css);
      return;
    } catch {
      /* fall through to the element */
    }
  }
  let st = doc.getElementById("lp-style");
  if (!st) {
    st = doc.createElement("style");
    st.id = "lp-style";
    doc.head.append(st);
  }
  if (st.textContent !== css) st.textContent = css;
  applied.set(doc, css);
}

const closestSlot = (t: EventTarget | null): HTMLElement | null =>
  (t as Element | null)?.closest?.("[data-slot]") as HTMLElement | null;

export interface PreviewProps {
  page: PageData;
  device: Device;
  /** Present only while the page is a draft the viewer can edit. Slots then edit in place. */
  onSlot?: (id: SlotId, text: string) => void;
  /** Slots with an open check. */
  flagged?: ReadonlySet<string>;
}

/**
 * The page exactly as the visitor gets it: the shared template inside an iframe of the real device
 * width, so its own media queries apply. In edit mode a click on a text block makes it editable in place.
 */
export function PagePreview({ page, device, onSlot, flagged }: PreviewProps) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const editing = useRef<{ id: SlotId; start: string } | null>(null);
  const onSlotRef = useRef(onSlot);
  onSlotRef.current = onSlot;
  const bound = useRef(new WeakSet<Document>());
  const [height, setHeight] = useState(900);
  const [tick, setTick] = useState(0);

  const edit = !!onSlot;
  const flaggedKey = [...(flagged ?? [])].sort().join(",");
  const labels = useMemo(
    () => ({
      edit: t("lp.slot.tag"),
      slots: Object.fromEntries(SLOT_IDS.map((id) => [id, t(`lp.slot.${id}`)])) as Record<
        SlotId,
        string
      >,
    }),
    [t],
  );
  const { css, body, title } = useMemo(
    () =>
      renderLandingParts(
        {
          brand: page.brand,
          lang: page.lang,
          prospect: page.prospect,
          slots: page.slots,
          references: page.references,
          contact: page.contact,
          expiresAt: page.expiresAt,
        },
        {
          mode: edit ? "edit" : "public",
          flagged: flaggedKey ? flaggedKey.split(",") : [],
          labels,
        },
      ),
    // biome-ignore lint/correctness/useExhaustiveDependencies: tick re-syncs the page after an edit ends
    [
      page.brand,
      page.lang,
      page.prospect,
      page.slots,
      page.references,
      page.contact,
      page.expiresAt,
      edit,
      flaggedKey,
      labels,
      tick,
    ],
  );

  const bind = (doc: Document) => {
    if (bound.current.has(doc)) return;
    bound.current.add(doc);
    const finish = (el: HTMLElement, keep: boolean) => {
      const cur = editing.current;
      if (!cur) return;
      if (!keep) {
        el.textContent = cur.start;
        onSlotRef.current?.(cur.id, cur.start);
      }
      el.removeAttribute("contenteditable");
      el.setAttribute("role", "button");
      el.setAttribute(
        "aria-label",
        `${el.dataset.edit ?? ""} ${el.dataset.name ?? ""}: ${el.textContent ?? ""}`,
      );
      editing.current = null;
      setTick((n) => n + 1);
    };
    const begin = (el: HTMLElement) => {
      if (editing.current || !onSlotRef.current) return;
      editing.current = { id: el.dataset.slot as SlotId, start: el.textContent ?? "" };
      el.setAttribute("contenteditable", "plaintext-only");
      if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
      el.setAttribute("role", "textbox");
      el.setAttribute("aria-label", el.dataset.name ?? "");
      el.focus();
      const sel = doc.defaultView?.getSelection();
      if (sel) {
        const r = doc.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    };
    doc.addEventListener("click", (e) => {
      const el = closestSlot(e.target);
      if (el) {
        e.preventDefault();
        begin(el);
      }
    });
    doc.addEventListener("keydown", (e) => {
      const el = closestSlot(e.target);
      if (!el) return;
      const live = editing.current?.id === el.dataset.slot;
      if (!live && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        begin(el);
      } else if (live && e.key === "Escape") {
        e.preventDefault();
        finish(el, false);
      } else if (live && e.key === "Enter") {
        e.preventDefault();
        finish(el, true);
      }
    });
    doc.addEventListener("input", (e) => {
      const el = closestSlot(e.target);
      const cur = editing.current;
      if (el && cur && cur.id === el.dataset.slot)
        onSlotRef.current?.(cur.id, el.textContent ?? "");
    });
    doc.addEventListener("paste", (e) => {
      const el = closestSlot(e.target);
      if (!el || !editing.current) return;
      e.preventDefault();
      doc.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? "");
    });
    doc.addEventListener("focusout", (e) => {
      const el = closestSlot(e.target);
      if (el && editing.current?.id === el.dataset.slot) finish(el, true);
    });
  };

  const sync = () => {
    const f = frame.current;
    const doc = f?.contentDocument;
    if (!f || !doc?.head || !doc.body) return;
    bind(doc);
    doc.documentElement.lang = page.lang;
    doc.title = title;
    setFrameCss(doc, css);
    if (editing.current) return;
    if (doc.body.dataset.src !== body) {
      doc.body.innerHTML = body;
      doc.body.dataset.src = body;
    }
    setHeight(doc.documentElement.scrollHeight);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: sync reads the latest render values
  useLayoutEffect(sync, [css, body, title, device]);
  useEffect(() => {
    const f = frame.current;
    const win = f?.contentWindow as (Window & typeof globalThis) | null | undefined;
    const doc = f?.contentDocument;
    if (!win || !doc?.body || typeof win.ResizeObserver === "undefined") return;
    const ro = new win.ResizeObserver(() => setHeight(doc.documentElement.scrollHeight));
    ro.observe(doc.body);
    return () => ro.disconnect();
  }, []);

  return (
    <iframe
      ref={frame}
      className="lp-iframe"
      title={t("lp.preview")}
      data-testid="page-preview"
      srcDoc="<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>"
      style={{ width: DEVICE_W[device], height }}
      onLoad={sync}
    />
  );
}

/** A small inert render of the page, for the list. It scales to the width of its card. */
export function PageThumb({ page }: { page: PageData }) {
  const parts = useMemo(() => renderLandingParts(page, { mode: "thumb" }), [page]);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.25);
  const fill = () => {
    const doc = frame.current?.contentDocument;
    if (!doc?.head || !doc.body) return;
    doc.documentElement.lang = page.lang;
    setFrameCss(doc, parts.css);
    if (doc.body.dataset.src !== parts.body) {
      doc.body.innerHTML = parts.body;
      doc.body.dataset.src = parts.body;
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: fill reads the latest render
  useLayoutEffect(fill, [parts, page.lang]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setScale(el.clientWidth / DEVICE_W.desktop);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="lp-thumbbox" ref={box} aria-hidden="true">
      {/* No scripts run in it (sandbox without allow-scripts); allow-same-origin lets the app set its styles. */}
      <iframe
        ref={frame}
        className="lp-thumb-frame"
        title={page.slots.hero}
        tabIndex={-1}
        loading="lazy"
        sandbox="allow-same-origin"
        srcDoc="<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>"
        onLoad={fill}
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}

/** The soft canvas and device frame. Fits the page to the width, or shows it at 100% in a scrolling region. */
export function Frame({
  device,
  actual,
  children,
  label,
}: {
  device: Device;
  actual: boolean;
  children: React.ReactNode;
  label: string;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const dev = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ w: DEVICE_W[device], h: 900 });
  useLayoutEffect(() => {
    const el = box.current;
    const d = dev.current;
    if (!el || !d || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setSize({ w: d.offsetWidth, h: d.offsetHeight });
      setScale(Math.min(1, (el.clientWidth - 48) / d.offsetWidth));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(d);
    return () => ro.disconnect();
  }, [device]);
  const z = actual ? 1 : scale;
  const region = (
    <div
      ref={box}
      className={`lp-frame ${device}${actual ? " actual" : ""}`}
      role="region"
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs a keyboard stop
      tabIndex={0}
      data-zoom={z.toFixed(2)}
    >
      <div className="lp-zoom" style={{ width: size.w * z, height: size.h * z }}>
        <div
          className={`lp-device ${device}`}
          key={device}
          ref={dev}
          style={{ transform: `scale(${z})` }}
        >
          {device === "desktop" ? (
            <div className="lp-chrome" aria-hidden="true">
              <i />
              <i />
              <i />
              <span />
            </div>
          ) : (
            <div className="lp-notch" aria-hidden="true" />
          )}
          {children}
        </div>
      </div>
    </div>
  );
  return (
    <div className="lp-framewrap">
      {region}
      <p className="muted lp-zoomnote">
        {t("lp.zoom.note", {
          device: t(`lp.dev.${device}`),
          w: DEVICE_W[device],
          pct: Math.round(z * 100),
        })}
      </p>
    </div>
  );
}
