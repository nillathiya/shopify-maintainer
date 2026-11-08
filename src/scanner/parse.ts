// Parse storefront HTML into page sections, links, images and text. Works on plain HTML
// (no browser needed), so a scan runs anywhere.
import { parse, HTMLElement, TextNode, type Node } from "node-html-parser";
import type { ImageRef, ImageSource, LinkKind, LinkRef, PageKind, PageSection, ScannedPage, StoreIdentity } from "./types.ts";
import { inferRole, makeLabel, slideCountFrom } from "./sections.ts";

const SKIP = new Set(["script", "style", "svg", "noscript", "template", "select", "option", "iframe", "head"]);
const BLOCK = new Set(["p", "li", "dt", "dd", "blockquote", "figcaption", "label", "td", "th", "div", "section", "article", "aside", "ul", "ol", "dl", "header", "footer", "nav", "form", "main", "figure", "table", "tr"]);
const HEADING = /^h[1-6]$/;

export function parseHtml(html: string): HTMLElement {
  return parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: true, pre: true } });
}

const tag = (el: HTMLElement) => (el.rawTagName ?? "").toLowerCase();
const clean = (s: string) => s.replace(/\s+/g, " ").trim();


/** Visible text of an element; inline pieces joined by spaces, <br> as space. */
export function textOf(node: Node, stop?: (el: HTMLElement) => boolean): string {
  if (node instanceof TextNode) return node.text;
  if (!(node instanceof HTMLElement)) return "";
  const t = tag(node);
  if (SKIP.has(t)) return "";
  if (t === "br") return " ";
  if (stop && stop(node)) return "";
  return clean(node.childNodes.map((c) => textOf(c, stop)).join(" "));
}

/** Rich-text HTML (descriptions, blog bodies) to readable Markdown-ish text that keeps paragraphs and bullets. */
export function htmlToMarkdown(html: string | null | undefined): string {
  if (!html) return "";
  const root = parseHtml(`<div>${html}</div>`);
  const out: string[] = [];
  let line = "";
  const flush = () => {
    const t = clean(line);
    if (t) out.push(t);
    line = "";
  };
  const visit = (n: Node) => {
    if (n instanceof TextNode) {
      line += n.text;
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    const t = tag(n);
    if (SKIP.has(t)) return;
    if (t === "br") return flush();
    const isBlock = BLOCK.has(t) || HEADING.test(t);
    if (isBlock) flush();
    if (t === "li") line += "- ";
    else if (HEADING.test(t)) line += "#".repeat(Math.min(6, Number(t[1]) + 1)) + " ";
    n.childNodes.forEach(visit);
    if (isBlock) flush();
  };
  visit(root);
  flush();
  return out.join("\n");
}

function walk(el: HTMLElement, visit: (el: HTMLElement) => boolean | void): void {
  for (const c of el.childNodes) {
    if (!(c instanceof HTMLElement)) continue;
    const t = tag(c);
    // Note: aria-hidden subtrees are walked on purpose: inactive slides are usually
    // aria-hidden, and duplicate marquee copies are removed by de-duplication instead.
    if (SKIP.has(t)) continue;
    if (visit(c) === false) continue; // false = don't descend
    walk(c, visit);
  }
}

export function linkKind(href: string, storeHost: string): LinkKind {
  let u: URL;
  try {
    u = new URL(href, `https://${storeHost}`);
  } catch {
    return "other";
  }
  if (!/^https?:$/.test(u.protocol)) return "other";
  const host = u.hostname.replace(/^www\./, "");
  if (host !== storeHost.replace(/^www\./, "") && !host.endsWith(".myshopify.com")) return "external";
  const p = u.pathname.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/i, ""); // strip locale prefix like /en-us
  if (p === "/" || p === "") return "home";
  if (/^\/(collections\/[^/]+\/)?products\/[^/]+/.test(p)) return "product";
  if (/^\/collections\/?$/.test(p)) return "collections";
  if (/^\/collections\/[^/]+/.test(p)) return "collection";
  if (/^\/pages\//.test(p)) return "page";
  if (/^\/blogs\/[^/]+\/[^/]+/.test(p)) return "article";
  if (/^\/blogs\//.test(p)) return "blog";
  if (/^\/search/.test(p)) return "search";
  if (/^\/cart/.test(p)) return "cart";
  if (/^\/account/.test(p)) return "account";
  return "other";
}

export function handleFrom(href: string, kind: "product" | "collection"): string | null {
  const m = href.match(kind === "product" ? /\/products\/([^/?#]+)/ : /\/collections\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Strip Shopify size suffixes and query strings so the same image compares equal everywhere. */
export function normalizeImageUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let u = raw.trim().split(/\s+/)[0];
  if (!u || u.startsWith("data:") || u.includes("{width}")) return null;
  if (u.startsWith("//")) u = "https:" + u;
  try {
    const url = new URL(u);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/_(\d+x\d*|x\d+)(_crop_[a-z]+)?(@\d+x)?(?=\.[a-z0-9]+$)/i, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function imageSource(src: string, storeHost: string): ImageSource {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return "other";
  }
  const p = url.pathname;
  const host = url.hostname.replace(/^www\./, "");
  const shopifyHost = host === storeHost.replace(/^www\./, "") || host === "cdn.shopify.com" || host.endsWith(".myshopify.com");
  if (!shopifyHost) return "external";
  if (/\/t\/\d+\/assets\//.test(p)) return "theme-file";
  if (/\/(cdn\/shop|s\/files\/[\d/]+)\/products\//.test(p)) return "product";
  if (/\/(cdn\/shop|s\/files\/[\d/]+)\/collections\//.test(p)) return "collection";
  if (/\/(cdn\/shop|s\/files\/[\d/]+)\/articles\//.test(p)) return "article";
  if (/\/(cdn\/shop|s\/files\/[\d/]+)\/files\//.test(p)) return "uploaded-file";
  return "other";
}

function bestFromSrcset(srcset: string | undefined): string | null {
  if (!srcset) return null;
  const parts = srcset.split(",").map((p) => p.trim().split(/\s+/));
  parts.sort((a, b) => parseInt(b[1] ?? "0") - parseInt(a[1] ?? "0"));
  return parts[0]?.[0] ?? null;
}

function collectImages(root: HTMLElement, storeHost: string): ImageRef[] {
  const seen = new Map<string, ImageRef>();
  const add = (raw: string | null | undefined, alt: string) => {
    const src = normalizeImageUrl(raw);
    if (!src || /\.svg$/i.test(src) || seen.has(src)) return;
    seen.set(src, { src, alt: clean(alt), source: imageSource(src, storeHost) });
  };
  walk(root, (el) => {
    const t = tag(el);
    if (t === "img") {
      add(el.getAttribute("src") || el.getAttribute("data-src") || bestFromSrcset(el.getAttribute("srcset") || el.getAttribute("data-srcset")), el.getAttribute("alt") ?? "");
    }
    const style = el.getAttribute("style");
    const m = style?.match(/background(?:-image)?\s*:[^;]*url\(['"]?([^'")]+)['"]?\)/i);
    if (m) add(m[1], "");
  });
  return [...seen.values()];
}

const BUTTON_CLASS = /(^|\s|_|-)(btn|button|cta)(\s|$|_|-)/i;

interface RawSection {
  el: HTMLElement;
  domId: string;
}

export function findSections(root: HTMLElement): RawSection[] {
  return root
    .querySelectorAll('[id^="shopify-section-"]')
    .map((el) => ({ el, domId: el.getAttribute("id")!.replace(/^shopify-section-/, "") }))
    // nested matches (rare) — keep outermost only
    .filter((s, _i, all) => !all.some((o) => o !== s && o.el !== s.el && isAncestor(o.el, s.el)));
}

function isAncestor(a: HTMLElement, b: HTMLElement): boolean {
  let p = b.parentNode as HTMLElement | null;
  while (p) {
    if (p === a) return true;
    p = p.parentNode as HTMLElement | null;
  }
  return false;
}

export function parseDomId(domId: string): { key: string; templateId: string | null; groupId: string | null } {
  const m = domId.match(/^(template|sections)--(\d+)__(.+)$/);
  if (!m) return { key: domId, templateId: null, groupId: null };
  return m[1] === "template" ? { key: m[3], templateId: m[2], groupId: null } : { key: m[3], templateId: null, groupId: m[2] };
}

const TEMPLATE_FILE: Record<PageKind, string> = {
  home: "templates/index.json",
  collection: "templates/collection.json",
  product: "templates/product.json",
  page: "templates/page.json",
  blog: "templates/blog.json",
  article: "templates/article.json",
  collections: "templates/list-collections.json",
  other: "",
};

export function parseSection(raw: RawSection, position: number, ctx: { storeHost: string; pageKind: PageKind; firstTemplateSection: boolean }): PageSection {
  const { el, domId } = raw;
  const { key, templateId } = parseDomId(domId);
  const cssClass = el.getAttribute("class") ?? "";
  const group: PageSection["group"] = /header-group/.test(cssClass) ? "header" : /footer-group/.test(cssClass) ? "footer" : templateId ? "template" : "other";
  const groupFile = group === "header" ? "sections/header-group.json" : group === "footer" ? "sections/footer-group.json" : templateId ? TEMPLATE_FILE[ctx.pageKind] || null : null;

  const headings: string[] = [];
  const texts: string[] = [];
  const buttons: LinkRef[] = [];
  const classNames: string[] = [];
  const productHandles: string[] = [];
  const collectionHandles: string[] = [];
  const lines: string[] = [];
  const seenImg = new Set<string>();
  const emit = (line: string) => {
    if (line && !lines.includes(line)) lines.push(line);
  };
  let linkCount = 0;
  let articleLinks = 0;
  let videoCount = 0;
  let hasEmailForm = false;

  const isStop = (x: HTMLElement) => HEADING.test(tag(x)) || tag(x) === "a" || tag(x) === "button" || BLOCK.has(tag(x)) || tag(x).includes("-");
  walk(el, (x) => {
    const t = tag(x);
    const cls = x.getAttribute("class");
    if (cls) classNames.push(cls);
    if (HEADING.test(t) || x.getAttribute("role") === "heading") {
      const h = textOf(x);
      if (h && !headings.includes(h)) headings.push(h);
      if (h) emit(`${"#".repeat(Math.min(6, Number(t[1]) || 3) + 1)} ${h}`);
      return; // keep descending: product cards often wrap their link inside the heading
    }
    if (t === "video" || (t === "iframe" && /youtube|vimeo/.test(x.getAttribute("src") ?? ""))) {
      videoCount++;
      emit(`[Video${x.getAttribute("aria-label") ? `: ${clean(x.getAttribute("aria-label")!)}` : ""}]`);
    }
    if (t === "input" && (x.getAttribute("type") === "email" || /email/i.test(x.getAttribute("name") ?? ""))) {
      hasEmailForm = true;
      emit("[Email sign-up box]");
    }
    if (t === "img") {
      const src = normalizeImageUrl(x.getAttribute("src") || x.getAttribute("data-src") || bestFromSrcset(x.getAttribute("srcset") || x.getAttribute("data-srcset")));
      if (src && !seenImg.has(src) && !/\.svg$/i.test(src)) {
        seenImg.add(src);
        emit(`![${clean(x.getAttribute("alt") ?? "") || "no description"}](${src})`);
      }
    }
    if (t === "a") {
      const href = x.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      linkCount++;
      const kind = linkKind(href, ctx.storeHost);
      if (kind === "product") {
        const h = handleFrom(href, "product");
        if (h) productHandles.push(h);
      } else if (kind === "collection") {
        const h = handleFrom(href, "collection");
        if (h) collectionHandles.push(h);
      } else if (kind === "article") articleLinks++;
      const linkText = textOf(x);
      if (BUTTON_CLASS.test(cls ?? "")) {
        if (linkText && !/^\d+$/.test(linkText) && !buttons.some((b) => b.href === href && b.text === linkText)) buttons.push({ href, text: linkText, kind, isButton: true });
        if (linkText) emit(`[Button: ${linkText}](${href})`);
        return false;
      }
      const lastHeading = lines.length ? lines[lines.length - 1].replace(/^#+ /, "") : "";
      if (linkText && linkText !== lastHeading && linkText.length <= 200) emit(`[${linkText}](${href})`);
      return;
    }
    if (t === "button") return false;
    // block-ish element with its own text (not counting nested blocks/headings/links)
    if (BLOCK.has(t) || t.includes("-")) {
      const own = textOf(x, (c) => c !== x && isStop(c));
      if (own && own.length >= 2 && !headings.includes(own)) {
        if (own.length <= 400 && !texts.includes(own)) texts.push(own);
        emit(own);
      }
    }
  });

  const images = collectImages(el, ctx.storeHost);
  const slideCount = slideCountFrom(classNames, headings.length, images.length);
  const features = {
    key, cssClass, group, headings, texts, buttons, images, videoCount, slideCount,
    productHandles: [...new Set(productHandles)], collectionHandles: [...new Set(collectionHandles)],
    hasEmailForm, linkCount, articleLinks, pageKind: ctx.pageKind, firstTemplateSection: ctx.firstTemplateSection,
  };
  const role = inferRole(features);
  return {
    domId, key, group, groupFile, position, cssClass, role,
    label: makeLabel(role, { headings, slideCount, texts }),
    headings: headings.slice(0, 60),
    texts: texts.slice(0, 60),
    buttons: buttons.slice(0, 30),
    linkCount, images, videoCount, slideCount,
    productHandles: features.productHandles, collectionHandles: features.collectionHandles,
    hasEmailForm,
    hidden: role === "cart",
    content: lines.join("\n").slice(0, 50_000),
  };
}

function meta(root: HTMLElement, sel: string): string {
  return root.querySelector(sel)?.getAttribute("content")?.trim() ?? "";
}

export function parsePage(html: string, info: { url: string; status: number; kind: PageKind; fetchMs: number; storeHost: string }): ScannedPage {
  const root = parseHtml(html);
  const raws = findSections(root);
  let firstTemplateSeen = false;
  const sections = raws.map((r, i) => {
    const isTemplate = r.domId.startsWith("template--");
    const s = parseSection(r, i, { storeHost: info.storeHost, pageKind: info.kind, firstTemplateSection: isTemplate && !firstTemplateSeen });
    if (isTemplate) firstTemplateSeen = true;
    return s;
  });
  const templateId = sections.map((s) => parseDomId(s.domId).templateId).find(Boolean) ?? null;
  return {
    kind: info.kind,
    url: info.url,
    status: info.status,
    title: clean(root.querySelector("title")?.text ?? ""),
    metaDescription: meta(root, 'meta[name="description"]'),
    h1: root.querySelectorAll("h1").map((h) => textOf(h)).filter(Boolean),
    canonical: root.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
    ogImage: meta(root, 'meta[property="og:image"]'),
    templateId,
    sections,
    fetchMs: info.fetchMs,
    bytes: html.length,
  };
}

const SOCIAL = /(instagram\.com|facebook\.com|fb\.com|youtube\.com|youtu\.be|pinterest\.|tiktok\.com|twitter\.com|x\.com|linkedin\.com|threads\.net|snapchat\.com)/i;

function jsonAfter(html: string, marker: string): any {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf("{", i);
  let depth = 0;
  for (let j = start; j < html.length && j < start + 5000; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, j + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const strAfter = (html: string, re: RegExp) => html.match(re)?.[1] ?? "";

export function parseIdentity(html: string, finalUrl: string): StoreIdentity {
  const root = parseHtml(html);
  const u = new URL(finalUrl);
  const host = u.hostname;
  const theme = jsonAfter(html, "Shopify.theme =") ?? {};
  const currency = jsonAfter(html, "Shopify.currency =") ?? {};
  const links = root.querySelectorAll("a[href]").map((a) => a.getAttribute("href")!);
  const abs = (h: string) => (h.startsWith("//") ? "https:" + h : h.startsWith("/") ? `${u.origin}${h}` : h);
  const social = [...new Set(links.filter((h) => SOCIAL.test(h)).map(abs))];
  const headerEls = root.querySelectorAll('[class*="shopify-section-group-header-group"]');
  const headerRoots = headerEls.length ? headerEls : root.querySelectorAll("header");
  const nav: Array<{ text: string; href: string }> = [];
  for (const a of headerRoots.flatMap((h) => h.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href")!;
    const text = textOf(a);
    const kind = linkKind(href, host);
    if (!text || text.length > 60 || ["external", "cart", "account", "search", "other"].includes(kind)) continue;
    if (!nav.some((n) => n.href === href)) nav.push({ text, href });
  }
  const logoEl = root.querySelector('img[class*="logo"], [class*="logo"] img, a[href="/"] img');
  const logoSvg = root.querySelector('[class*="logo"] svg, a[href="/"] svg');
  return {
    url: u.origin,
    name: meta(root, 'meta[property="og:site_name"]') || clean(root.querySelector("title")?.text ?? "").split(/[–—|-]/)[0].trim(),
    shopDomain: strAfter(html, /Shopify\.shop\s*=\s*"([^"]+)"/),
    theme: {
      name: theme.name ?? "",
      id: theme.id ?? null,
      schemaName: theme.schema_name ?? "",
      schemaVersion: theme.schema_version ?? "",
      themeStoreId: theme.theme_store_id ?? null,
      custom: theme.name ? theme.theme_store_id == null : false,
    },
    locale: strAfter(html, /Shopify\.locale\s*=\s*"([^"]+)"/),
    currency: currency.active ?? "",
    country: strAfter(html, /Shopify\.country\s*=\s*"([^"]+)"/),
    title: clean(root.querySelector("title")?.text ?? ""),
    description: meta(root, 'meta[name="description"]'),
    ogImage: meta(root, 'meta[property="og:image"]'),
    favicon: abs(root.querySelector('link[rel~="icon"]')?.getAttribute("href") ?? ""),
    logo: logoEl ? normalizeImageUrl(abs(logoEl.getAttribute("src") ?? "")) ?? "" : logoSvg ? "svg" : "",
    socialLinks: social,
    contact: {
      email: [...new Set(links.filter((h) => h.startsWith("mailto:")).map((h) => h.slice(7).split("?")[0]))],
      phone: [...new Set(links.filter((h) => h.startsWith("tel:")).map((h) => h.slice(4)))],
      whatsapp: [...new Set(links.filter((h) => /wa\.me|whatsapp\.com/.test(h)).map(abs))],
    },
    navigation: nav.slice(0, 40),
    passwordProtected: u.pathname.startsWith("/password"),
  };
}
