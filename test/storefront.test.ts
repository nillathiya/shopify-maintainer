import { test } from "node:test";
import assert from "node:assert/strict";
import { allPages, mapProduct } from "../src/scanner/storefront.ts";
import { diffSnapshots } from "../src/scanner/diff.ts";
import { pageSlug } from "../src/scanner/visual.ts";

const identity: any = { navigation: [] };
const products: any[] = Array.from({ length: 50 }, (_, i) => ({ handle: `p${i}`, available: true, images: [{}] }));
const collections: any[] = [{ handle: "all", productsCount: 50 }, { handle: "bags", productsCount: 10 }];
const content = { pages: [{ url: "https://s.com/pages/about", lastmod: "" }], blogs: [{ url: "https://s.com/blogs/news", lastmod: "" }], articles: [{ url: "https://s.com/blogs/news/a", lastmod: "2026-02-01" }, { url: "https://s.com/blogs/news/b", lastmod: "2026-03-01" }] };

test("lists every page when under the limit", () => {
  const { targets, skipped } = allPages(identity, products, collections, content, 500);
  assert.equal(skipped, 0);
  assert.equal(targets.length, 2 + 2 + 1 + 1 + 50 + 2);
  assert.deepEqual(targets.slice(0, 2).map((t) => t.path), ["/", "/collections"]);
  assert.equal(targets.at(-1)!.path, "/blogs/news/a", "newest posts first");
});

test("the page limit always keeps one page of every kind", () => {
  const { targets, skipped } = allPages(identity, products, collections, content, 10);
  assert.equal(targets.length, 10);
  assert.equal(skipped, 58 - 10);
  for (const kind of ["home", "collections", "collection", "page", "blog", "product", "article"]) assert.ok(targets.some((t) => t.kind === kind), kind);
});

test("maps products.json with string tags and price range", () => {
  const p = mapProduct({ id: 1, title: "T", handle: "t", body_html: "<p>Hi</p>", vendor: "V", product_type: "", tags: "a, b", created_at: "", updated_at: "", published_at: "", options: [], images: [],
    variants: [{ id: 1, title: "S", sku: null, price: "10.00", compare_at_price: null, available: false, option1: "S", option2: null, option3: null }, { id: 2, title: "M", sku: "X", price: "12.50", compare_at_price: null, available: true, option1: "M", option2: null, option3: null }] } as any);
  assert.deepEqual(p.tags, ["a", "b"]);
  assert.equal(p.priceMin, 10);
  assert.equal(p.priceMax, 12.5);
  assert.equal(p.available, true);
  assert.equal(p.variants[0].sku, "");
});

test("page file names are short and safe", () => {
  assert.equal(pageSlug({ kind: "home", url: "https://s.com/" }), "home");
  assert.equal(pageSlug({ kind: "collections", url: "https://s.com/collections" }), "collections");
  assert.equal(pageSlug({ kind: "product", url: "https://s.com/products/tan-bag" }), "product--tan-bag");
  assert.equal(pageSlug({ kind: "article", url: "https://s.com/blogs/news/hello-world" }), "article--news--hello-world");
});

test("describes changes between scans", () => {
  const base: any = { identity: { theme: { id: 1, name: "A", schemaVersion: "1.0" } }, products: [], collections: [], pages: [], findings: [] };
  const prev = { ...base, products: [{ handle: "a", title: "A", priceMin: 1, priceMax: 1, available: true, images: [1] }], findings: [{ id: "x", severity: "high", title: "Broken thing" }] };
  const next = { ...base, identity: { theme: { id: 1, name: "A", schemaVersion: "1.1" } }, products: [{ handle: "a", title: "A", priceMin: 1, priceMax: 1, available: false, images: [1] }, { handle: "b", title: "B", priceMin: 2, priceMax: 2, available: true, images: [] }] };
  assert.deepEqual(diffSnapshots(prev, next).map((c) => c.text), ["Theme updated from v1.0 to v1.1.", "New product: B", "A is now sold out", "Fixed: Broken thing"]);
});
