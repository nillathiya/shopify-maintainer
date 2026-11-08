// Public storefront collection: identity, catalog (products.json / collections.json),
// sitemap content index, key pages, and internal link health. No credentials required.
import { StorefrontClient, mapLimit } from "./http.ts";
import { parseHtml, linkKind, parsePage, parseIdentity, normalizeImageUrl, htmlToMarkdown } from "./parse.ts";
import type { Collection, ContentIndex, PageKind, Product, ScannedPage, StoreIdentity } from "./types.ts";

const htmlToText = htmlToMarkdown;

export async function fetchIdentity(client: StorefrontClient): Promise<{ identity: StoreIdentity; homeHtml: string; homeMs: number; homeStatus: number }> {
  const r = await client.get("/");
  if (r.status >= 400) throw new Error(`The store homepage answered with error ${r.status}. Check the store address.`);
  if (!/Shopify\.(shop|theme)|cdn\.shopify\.com|\/cdn\/shop\//.test(r.body)) {
    throw new Error("This address doesn't look like a Shopify store. Check the store address.");
  }
  return { identity: parseIdentity(r.body, r.url), homeHtml: r.body, homeMs: r.ms, homeStatus: r.status };
}

interface RawProduct {
  id: number; title: string; handle: string; body_html: string; vendor: string; product_type: string;
  tags: string[] | string; created_at: string; updated_at: string; published_at: string;
  options: Array<{ name: string; values: string[] }>;
  variants: Array<{ id: number; title: string; sku: string | null; price: string; compare_at_price: string | null; available: boolean; option1: string | null; option2: string | null; option3: string | null }>;
  images: Array<{ src: string; width: number; height: number; alt?: string | null }>;
}

export function mapProduct(p: RawProduct): Product {
  const prices = p.variants.map((v) => parseFloat(v.price)).filter((n) => !isNaN(n));
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    vendor: p.vendor ?? "",
    productType: p.product_type ?? "",
    tags: Array.isArray(p.tags) ? p.tags : String(p.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    descriptionText: htmlToText(p.body_html),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    publishedAt: p.published_at,
    options: (p.options ?? []).map((o) => ({ name: o.name, values: o.values ?? [] })),
    variants: p.variants.map((v) => ({
      id: v.id, title: v.title, sku: v.sku ?? "", price: v.price, compareAtPrice: v.compare_at_price, available: Boolean(v.available),
      options: [v.option1, v.option2, v.option3].filter((x): x is string => Boolean(x)),
    })),
    images: (p.images ?? []).map((i) => ({ src: normalizeImageUrl(i.src) ?? i.src, alt: i.alt ?? "", width: i.width, height: i.height })),
    collections: [],
    priceMin: prices.length ? Math.min(...prices) : 0,
    priceMax: prices.length ? Math.max(...prices) : 0,
    available: p.variants.some((v) => v.available),
  };
}

export async function fetchProducts(client: StorefrontClient, maxPages = 20): Promise<Product[]> {
  const out: Product[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const d = await client.json<{ products: RawProduct[] }>(`/products.json?limit=250&page=${page}`);
    if (!d?.products?.length) break;
    out.push(...d.products.map(mapProduct));
    if (d.products.length < 250) break;
  }
  return out;
}

/** products.json has no image alt text; the per-product .js endpoint does. */
export async function fillImageAlts(client: StorefrontClient, products: Product[], limit = 150): Promise<void> {
  await mapLimit(products.slice(0, limit), 3, async (p) => {
    const d = await client.json<{ media?: Array<{ alt: string | null; src?: string; preview_image?: { src: string } }> }>(`/products/${encodeURIComponent(p.handle)}.js`);
    if (!d?.media) return;
    const alts = new Map<string, string>();
    for (const m of d.media) {
      const src = normalizeImageUrl(m.src ?? m.preview_image?.src);
      if (src) alts.set(fileName(src), m.alt ?? "");
    }
    for (const img of p.images) {
      const alt = alts.get(fileName(img.src));
      if (alt !== undefined) img.alt = alt === p.title ? "" : alt; // Shopify falls back to the title when alt is empty
    }
  });
}

export const fileName = (src: string) => decodeURIComponent(src.split("?")[0].split("/").pop() ?? src);

export async function fetchCollections(client: StorefrontClient, products: Product[]): Promise<Collection[]> {
  const out: Collection[] = [];
  for (let page = 1; page <= 10; page++) {
    const d = await client.json<{ collections: any[] }>(`/collections.json?limit=250&page=${page}`);
    if (!d?.collections?.length) break;
    for (const c of d.collections) {
      out.push({
        id: c.id, handle: c.handle, title: c.title, descriptionText: htmlToText(c.description),
        image: normalizeImageUrl(c.image?.src) ?? "", productsCount: c.products_count ?? 0, productHandles: [], updatedAt: c.updated_at,
      });
    }
    if (d.collections.length < 250) break;
  }
  const byHandle = new Map(products.map((p) => [p.handle, p]));
  await mapLimit(out, 3, async (c) => {
    for (let page = 1; page <= 4; page++) {
      const d = await client.json<{ products: Array<{ handle: string }> }>(`/collections/${encodeURIComponent(c.handle)}/products.json?limit=250&page=${page}`);
      if (!d?.products?.length) break;
      c.productHandles.push(...d.products.map((p) => p.handle));
      if (d.products.length < 250) break;
    }
    if (!c.productsCount) c.productsCount = c.productHandles.length;
    for (const h of c.productHandles) byHandle.get(h)?.collections.push(c.handle);
  });
  return out;
}

function sitemapLocs(xml: string): Array<{ url: string; lastmod: string }> {
  const out: Array<{ url: string; lastmod: string }> = [];
  for (const m of xml.matchAll(/<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/g)) {
    const loc = m[1].match(/<loc>([^<]+)<\/loc>/)?.[1]?.replace(/&amp;/g, "&");
    if (loc) out.push({ url: loc.trim(), lastmod: m[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? "" });
  }
  return out;
}

export async function fetchContentIndex(client: StorefrontClient): Promise<ContentIndex> {
  const idx: ContentIndex = { pages: [], blogs: [], articles: [] };
  const root = await client.get("/sitemap.xml", { accept: "application/xml" });
  if (root.status !== 200) return idx;
  for (const sm of sitemapLocs(root.body)) {
    const bucket = /sitemap_pages/.test(sm.url) ? idx.pages : /sitemap_blogs/.test(sm.url) ? idx.blogs : /sitemap_articles/.test(sm.url) ? idx.articles : null;
    if (!bucket) continue;
    const r = await client.get(sm.url, { accept: "application/xml" });
    if (r.status === 200) bucket.push(...sitemapLocs(r.body));
  }
  return idx;
}

export interface PageTarget {
  kind: PageKind;
  path: string;
}

/** Pick one representative page per template so the scan sees every layout the store uses. */
export function choosePages(identity: StoreIdentity, products: Product[], collections: Collection[], content: ContentIndex): PageTarget[] {
  const targets: PageTarget[] = [{ kind: "home", path: "/" }];
  const navCollection = identity.navigation.map((n) => n.href.match(/^\/collections\/([^/?#]+)/)?.[1]).find((h) => h && collections.some((c) => c.handle === h && c.productsCount > 0));
  const collection = navCollection ?? [...collections].sort((a, b) => b.productsCount - a.productsCount)[0]?.handle;
  if (collection) targets.push({ kind: "collection", path: `/collections/${collection}` });
  const product = products.find((p) => p.available && p.images.length) ?? products[0];
  if (product) targets.push({ kind: "product", path: `/products/${product.handle}` });
  targets.push({ kind: "collections", path: "/collections" });
  const page = content.pages.find((p) => !/\/(contact|privacy|terms|refund|shipping)/.test(p.url)) ?? content.pages[0];
  if (page) targets.push({ kind: "page", path: new URL(page.url).pathname });
  if (content.blogs[0]) targets.push({ kind: "blog", path: new URL(content.blogs[0].url).pathname });
  const latestArticle = [...content.articles].sort((a, b) => b.lastmod.localeCompare(a.lastmod))[0];
  if (latestArticle) targets.push({ kind: "article", path: new URL(latestArticle.url).pathname });
  return targets;
}

/** Every page of the store: home, collection list, each collection, product, page, blog and blog post. */
export function allPages(identity: StoreIdentity, products: Product[], collections: Collection[], content: ContentIndex, maxPages: number): { targets: PageTarget[]; skipped: number } {
  const path = (u: string) => {
    try {
      return new URL(u).pathname;
    } catch {
      return u;
    }
  };
  const groups: PageTarget[][] = [
    [{ kind: "home", path: "/" }, { kind: "collections", path: "/collections" }],
    collections.map((c) => ({ kind: "collection" as const, path: `/collections/${c.handle}` })),
    content.pages.map((p) => ({ kind: "page" as const, path: path(p.url) })),
    content.blogs.map((b) => ({ kind: "blog" as const, path: path(b.url) })),
    products.map((p) => ({ kind: "product" as const, path: `/products/${p.handle}` })),
    [...content.articles].sort((a, b) => b.lastmod.localeCompare(a.lastmod)).map((a) => ({ kind: "article" as const, path: path(a.url) })),
  ];
  const seen = new Set<string>();
  const all = groups.flat().filter((t) => (seen.has(t.path) ? false : (seen.add(t.path), true)));
  // Make sure at least one of every kind survives the cap, then fill in order.
  const firstOfKind = all.filter((t, i) => all.findIndex((x) => x.kind === t.kind) === i);
  const rest = all.filter((t) => !firstOfKind.includes(t));
  const targets = [...firstOfKind, ...rest].slice(0, Math.max(maxPages, firstOfKind.length));
  const order = new Map(all.map((t, i) => [t.path, i]));
  targets.sort((a, b) => order.get(a.path)! - order.get(b.path)!);
  return { targets, skipped: all.length - targets.length };
}

export async function scanPages(
  client: StorefrontClient,
  targets: PageTarget[],
  storeHost: string,
  preloaded?: { path: string; html: string; ms: number; status: number },
  onProgress?: (done: number, total: number) => void,
): Promise<ScannedPage[]> {
  let done = 0;
  return mapLimit(targets, 3, async (t) => {
    let page: ScannedPage;
    if (preloaded && t.path === preloaded.path) {
      page = parsePage(preloaded.html, { url: client.abs(t.path), status: preloaded.status, kind: t.kind, fetchMs: preloaded.ms, storeHost });
    } else {
      const r = await client.get(t.path);
      page = parsePage(r.body, { url: r.url, status: r.status, kind: t.kind, fetchMs: r.ms, storeHost });
    }
    onProgress?.(++done, targets.length);
    return page;
  });
}

export interface LinkCheck {
  url: string;
  status: number;
  foundOn: string[];
}

/** Check every internal link found on the scanned pages (deduplicated, query strings dropped). */
export async function checkInternalLinks(client: StorefrontClient, pages: ScannedPage[], homeHtml: string, storeHost: string, max = 200): Promise<LinkCheck[]> {
  const found = new Map<string, Set<string>>();
  const add = (href: string, on: string) => {
    const kind = linkKind(href, storeHost);
    if (["external", "other", "cart", "account", "search"].includes(kind)) return;
    let u: URL;
    try {
      u = new URL(href, client.base);
    } catch {
      return;
    }
    const key = u.pathname.replace(/\/$/, "") || "/";
    if (!found.has(key)) found.set(key, new Set());
    found.get(key)!.add(on);
  };
  for (const a of parseHtml(homeHtml).querySelectorAll("a[href]")) add(a.getAttribute("href")!, "/");
  for (const p of pages) {
    const on = new URL(p.url).pathname;
    for (const s of p.sections) {
      for (const b of s.buttons) add(b.href, on);
      for (const h of s.productHandles) add(`/products/${h}`, on);
      for (const h of s.collectionHandles) add(`/collections/${h}`, on);
    }
  }
  const list = [...found].slice(0, max);
  return mapLimit(list, 4, async ([path, on]) => {
    let r = await client.get(path, { method: "HEAD" });
    if (r.status === 405) r = await client.get(path);
    return { url: path, status: r.status, foundOn: [...on] };
  });
}
