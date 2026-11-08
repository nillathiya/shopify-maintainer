// End-to-end: scan a fake store twice (no network, no browser) and check what lands in local memory.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "sm-test-"));
process.env.DATA_DIR = dataDir;
process.env.STOREFRONT_URL = "";

const home = readFileSync(new URL("./fixtures/store-home.html", import.meta.url), "utf8");
const simplePage = (title: string, body: string) =>
  `<html><head><title>${title} – Acme Bags</title></head><body><div id="shopify-section-template--9__main" class="shopify-section"><h1>${title}</h1>${body}</div></body></html>`;

let weekenderPrice = "7900.00";
const products = () => [
  { id: 1, handle: "tan-backpack", title: "Tan Backpack", body_html: "<p>Nice bag.</p>", vendor: "Acme", product_type: "Backpack", tags: ["leather"], created_at: "2026-01-01", updated_at: "2026-01-02", published_at: "2026-01-01", options: [{ name: "Color", values: ["Tan"] }], variants: [{ id: 11, title: "Tan", sku: "TB-1", price: "4500.00", compare_at_price: null, available: true, option1: "Tan", option2: null, option3: null }], images: [{ src: "https://cdn.shopify.com/s/files/1/0001/0002/files/tan-backpack-1.jpg?v=1", width: 1000, height: 1250 }] },
  { id: 2, handle: "weekender", title: "Weekender", body_html: "<p>" + "A roomy travel bag in full-grain leather with brass hardware. ".repeat(4) + "</p>", vendor: "Acme", product_type: "Travel", tags: "travel, leather", created_at: "2026-01-01", updated_at: "2026-01-02", published_at: "2026-01-01", options: [{ name: "Color", values: ["Brown"] }], variants: [{ id: 21, title: "Brown", sku: "", price: weekenderPrice, compare_at_price: "7000.00", available: true, option1: "Brown", option2: null, option3: null }], images: [1, 2, 3].map((n) => ({ src: `https://cdn.shopify.com/s/files/1/0001/0002/files/weekender-${n}.jpg`, width: 1000, height: 1250 })) },
  { id: 3, handle: "old-wallet", title: "Old Wallet", body_html: "", vendor: "Acme", product_type: "", tags: [], created_at: "2026-01-01", updated_at: "2026-01-02", published_at: "2026-01-01", options: [], variants: [{ id: 31, title: "Default Title", sku: "W-1", price: "900.00", compare_at_price: null, available: false, option1: null, option2: null, option3: null }], images: [] },
];
const collections = [
  { id: 100, handle: "bestsellers", title: "Bestsellers", description: "<p>Our most loved bags, picked by thousands of customers.</p>", updated_at: "2026-01-01", image: { src: "https://cdn.shopify.com/s/files/1/0001/0002/collections/best.jpg" }, products_count: 2 },
  { id: 101, handle: "backpacks", title: "Backpacks", description: "", updated_at: "2026-01-01", image: null, products_count: 1 },
  { id: 102, handle: "sale", title: "Sale", description: "", updated_at: "2026-01-01", image: null, products_count: 0 },
];
const members: Record<string, string[]> = { bestsellers: ["tan-backpack", "weekender"], backpacks: ["tan-backpack"], sale: [] };

function fakeStore(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const u = new URL(String(input));
  const p = u.pathname;
  const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json" } });
  const html = (b: string, status = 200) => new Response(init?.method === "HEAD" ? null : b, { status, headers: { "content-type": "text/html" } });
  if (p === "/") return Promise.resolve(html(home));
  if (p === "/products.json") return Promise.resolve(json({ products: u.searchParams.get("page") === "1" ? products() : [] }));
  if (p === "/collections.json") return Promise.resolve(json({ collections: u.searchParams.get("page") === "1" ? collections : [] }));
  const m = p.match(/^\/collections\/([^/]+)\/products\.json$/);
  if (m) return Promise.resolve(json({ products: u.searchParams.get("page") === "1" ? (members[m[1]] ?? []).map((handle) => ({ handle })) : [] }));
  const js = p.match(/^\/products\/([^/]+)\.js$/);
  if (js) {
    const prod = products().find((x) => x.handle === js[1]);
    return Promise.resolve(json({ media: prod?.images.map((im, i) => ({ src: im.src, alt: i === 0 ? null : "Brown weekender, side view" })) ?? [] }));
  }
  if (p === "/sitemap.xml") return Promise.resolve(html(`<sitemapindex><sitemap><loc>https://acme.example/sitemap_pages_1.xml</loc></sitemap><sitemap><loc>https://acme.example/sitemap_articles_1.xml</loc></sitemap></sitemapindex>`));
  if (p === "/sitemap_pages_1.xml") return Promise.resolve(html(`<urlset><url><loc>https://acme.example/pages/about</loc><lastmod>2026-01-01</lastmod></url></urlset>`));
  if (p === "/sitemap_articles_1.xml") return Promise.resolve(html(`<urlset></urlset>`));
  if (p === "/pages/about") return Promise.resolve(html(simplePage("About us", "<p>We make bags by hand in Jaipur.</p>")));
  if (p === "/collections") return Promise.resolve(html(simplePage("Collections", "<a href='/collections/bestsellers'>Bestsellers</a>")));
  if (/^\/collections\/[^/]+$/.test(p) || /^\/products\/[^/]+$/.test(p)) return Promise.resolve(html(simplePage(p.split("/").pop()!, "<p>Some words.</p>")));
  return Promise.resolve(html("Not found", 404));
}

let mod: any;
before(async () => {
  const http = await import("../src/scanner/http.ts");
  http.setDefaultFetch(fakeStore as typeof fetch);
  const settings = await import("../src/memory/settings.ts");
  settings.saveSettings({ takePictures: false });
  mod = {
    pipeline: await import("../src/scanner/pipeline.ts"),
    store: await import("../src/context/store.ts"),
    db: await import("../src/memory/db.ts"),
  };
});
after(() => rmSync(dataDir, { recursive: true, force: true }));

test("first scan reads every page and writes the store context", async () => {
  const job = await mod.pipeline.runScanNow({ storeUrl: "acme.example" });
  assert.equal(job.status, "done", job.error ?? "");
  assert.equal(job.steps.find((s: any) => s.id === "pictures").status, "skipped");
  assert.equal(job.steps.find((s: any) => s.id === "admin").status, "skipped");

  const snap = mod.pipeline.latestSnapshot();
  assert.equal(snap.identity.name, "Acme Bags");
  assert.equal(snap.products.length, 3);
  assert.deepEqual(snap.products.find((p: any) => p.handle === "tan-backpack").collections.sort(), ["backpacks", "bestsellers"]);
  // home + collections list + 3 collections + 1 page + 3 products
  assert.equal(snap.pages.length, 9);
  // photos that belong to products are recognised as product photos on the homepage
  const fc = snap.pages[0].sections.find((s: any) => s.key === "featured_collection");
  assert.ok(fc.images.every((i: any) => i.source === "product" || i.src.includes("wallet")));

  const ids = snap.findings.map((f: any) => f.id);
  for (const id of ["catalog.no-images", "catalog.sold-out", "catalog.compare-price", "catalog.thin-description", "catalog.no-sku", "catalog.not-in-collection", "catalog.empty-collections", "links.broken", "links.generic-social", "content.old-year", "content.seasonal", "seo.missing-alt", "seo.no-meta"]) {
    assert.ok(ids.includes(id), `expected finding ${id}; got ${ids.join(", ")}`);
  }
  assert.ok(!ids.includes("setup.custom-theme"), "Dawn is a Theme Store theme");

  const dir = mod.store.contextDir();
  for (const f of ["STORE.md", "NOTES.md", "manifest.json", "snapshot.json", "pages/home.md", "pages/page--about.md", "catalog/products/weekender.md", "catalog/products.json"]) assert.ok(existsSync(path.join(dir, f)), `missing ${f}`);
  const storeMd = readFileSync(path.join(dir, "STORE.md"), "utf8");
  assert.match(storeMd, /# Store context: Acme Bags/);
  assert.match(storeMd, /Main banner slider · 2 slides/);
  assert.match(readFileSync(path.join(dir, "pages/home.md"), "utf8"), /Diwali sale: 20% off everything/);
  const manifest = mod.store.readManifest();
  assert.equal(manifest.scanId, job.id);
  assert.equal(manifest.entry, "STORE.md");
  assert.ok(manifest.files.some((f: any) => f.path === "pages/home.md" && f.url === "https://acme.example/"));
});

test("second scan reports changes, keeps notes and moves the old context to history", async () => {
  const firstId = mod.store.readManifest().scanId;
  writeFileSync(path.join(mod.store.contextDir(), "NOTES.md"), "# Notes\nNever discount more than 30%.\n");
  weekenderPrice = "8400.00";
  const job = await mod.pipeline.runScanNow({});
  assert.equal(job.status, "done", job.error ?? "");
  const scans = mod.pipeline.listScans();
  assert.equal(scans.length, 2);
  assert.ok(scans[0].summary.changes.some((c: any) => c.text === "Price changed for Weekender: 7900 → 8400"));
  assert.match(readFileSync(path.join(mod.store.contextDir(), "NOTES.md"), "utf8"), /Never discount more than 30%/);
  assert.match(readFileSync(path.join(mod.store.contextDir(), "STORE.md"), "utf8"), /Changes since the previous scan/);
  assert.ok(existsSync(path.join(mod.store.historyRoot(), firstId, "STORE.md")));
  assert.equal(readdirSync(path.join(dataDir, "staging")).length, 0, "staging is cleaned up");
});

test("a failed scan leaves the current context untouched", async () => {
  const before = mod.store.readManifest().scanId;
  const http = await import("../src/scanner/http.ts");
  http.setDefaultFetch((() => Promise.resolve(new Response("<html>not a shop</html>", { status: 200 }))) as typeof fetch);
  const job = await mod.pipeline.runScanNow({});
  assert.equal(job.status, "failed");
  assert.match(job.error, /doesn't look like a Shopify store/);
  assert.equal(mod.store.readManifest().scanId, before);
  http.setDefaultFetch(fakeStore as typeof fetch);
});
