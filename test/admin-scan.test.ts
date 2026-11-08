// The optional admin scan, against a fake Admin API: links storefront sections to their editable
// theme settings and finds which theme code uses the pictures built into the theme.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "sm-admin-"));
process.env.DATA_DIR = dataDir;
const html = readFileSync(new URL("./fixtures/store-home.html", import.meta.url), "utf8");

const files: Record<string, string> = {
  "templates/index.json": `/* auto-generated */\n${JSON.stringify({
    sections: {
      slideshow: { type: "slideshow", settings: {}, blocks: { s1: { type: "slide", settings: { heading: "Carry it everywhere", button_label: "Shop backpacks", image: "shopify://shop_images/slide-1.jpg" } } }, block_order: ["s1"] },
      featured_collection: { type: "featured-collection", settings: { title: "Bestsellers", collection: "bestsellers" } },
    },
    order: ["slideshow", "featured_collection"],
  })}`,
  "sections/header-group.json": JSON.stringify({ type: "header", sections: { "announcement-bar": { type: "announcement-bar", blocks: { a1: { type: "announcement", settings: { text: "Diwali sale" } } }, block_order: ["a1"] } }, order: ["announcement-bar"] }),
  "config/settings_data.json": JSON.stringify({ current: { colors_accent_1: "#0f766e" } }),
  "sections/slideshow.liquid": `{{ 'slide-2.jpg' | asset_url | image_tag }}`,
};
const match = (patterns: string[]) => Object.keys(files).filter((f) => patterns.some((p) => new RegExp("^" + p.replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$").test(f)));

let calls: string[] = [];
before(async () => {
  const settings = await import("../src/memory/settings.ts");
  settings.saveSettings({ shopDomain: "acme-bags.myshopify.com", adminToken: "shpat_test" });
  const client = await import("../src/shopify/client.ts");
  client.setShopifyFetch((async (url: string, init: RequestInit) => {
    calls.push(String(url));
    assert.equal((init.headers as Record<string, string>)["X-Shopify-Access-Token"], "shpat_test");
    const { query, variables } = JSON.parse(String(init.body));
    if (query.includes("themes(first")) return Response.json({ data: { themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/1", name: "Dawn", role: "MAIN", processing: false }] } } });
    if (query.includes("theme(id")) {
      const nodes = match(variables.filenames).map((filename) => ({ filename, checksumMd5: "x", body: { content: files[filename] } }));
      return Response.json({ data: { theme: { files: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } });
    }
    return Response.json({ errors: [{ message: "unexpected query" }] });
  }) as typeof fetch);
});
after(() => rmSync(dataDir, { recursive: true, force: true }));

test("links storefront sections to their editable theme settings", async () => {
  const { parsePage } = await import("../src/scanner/parse.ts");
  const { adminScan } = await import("../src/scanner/admin-scan.ts");
  const page = parsePage(html, { url: "https://acme.example/", status: 200, kind: "home", fetchMs: 1, storeHost: "acme.example" });
  const { admin } = await adminScan([page]);

  assert.ok(calls.every((u) => u === "https://acme-bags.myshopify.com/admin/api/2026-10/graphql.json"));
  assert.equal(admin.themeName, "Dawn");
  assert.deepEqual(admin.templates, ["templates/index.json"]);
  assert.equal(admin.editableSlotCount, 5);
  assert.deepEqual(admin.palette, ["#0f766e"]);

  const by = (k: string) => page.sections.find((s) => s.key === k)!;
  assert.deepEqual(by("slideshow").editable!.map((e) => `${e.blockId}/${e.setting}:${e.kind}`), ["s1/heading:heading", "s1/button_label:button", "s1/image:image"]);
  assert.deepEqual(by("announcement-bar").editable!.map((e) => e.value), ["Diwali sale"]);
  assert.equal(by("announcement-bar").groupFile, "sections/header-group.json");
  assert.equal(by("marquee").editable, undefined);

  // slide-2.jpg is a theme file picture on the storefront; the section code that uses it is found.
  assert.deepEqual(admin.hardcodedImages, { "slide-2.jpg": ["sections/slideshow.liquid"] });
});
