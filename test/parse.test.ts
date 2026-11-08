import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePage, parseIdentity, normalizeImageUrl, imageSource, linkKind, htmlToMarkdown } from "../src/scanner/parse.ts";

const html = readFileSync(new URL("./fixtures/store-home.html", import.meta.url), "utf8");
const page = parsePage(html, { url: "https://acme.example/", status: 200, kind: "home", fetchMs: 5, storeHost: "acme.example" });
const byKey = (k: string) => page.sections.find((s) => s.key === k)!;

test("finds every section in page order with Shopify keys and groups", () => {
  assert.deepEqual(page.sections.map((s) => s.key), ["announcement-bar", "header", "slideshow", "marquee", "featured_collection", "newsletter", "footer", "cart-drawer"]);
  assert.equal(byKey("header").group, "header");
  assert.equal(byKey("header").groupFile, "sections/header-group.json");
  assert.equal(byKey("slideshow").groupFile, "templates/index.json");
  assert.equal(byKey("newsletter").group, "footer");
  assert.equal(page.templateId, "222");
});

test("labels sections in plain language", () => {
  assert.equal(byKey("announcement-bar").role, "announcement");
  assert.equal(byKey("header").role, "header");
  assert.equal(byKey("slideshow").role, "hero-slider");
  assert.match(byKey("slideshow").label, /Main banner slider · 2 slides — “Carry it everywhere”/);
  assert.equal(byKey("marquee").role, "scrolling-text");
  assert.equal(byKey("featured_collection").role, "product-grid");
  assert.equal(byKey("newsletter").role, "newsletter");
  assert.equal(byKey("footer").role, "footer");
  assert.equal(byKey("cart-drawer").hidden, true);
});

test("includes hidden slides but de-duplicates repeated marquee copies", () => {
  const slides = byKey("slideshow");
  assert.equal(slides.slideCount, 2);
  assert.deepEqual(slides.headings, ["Carry it everywhere", "New: the weekender"]);
  assert.deepEqual(byKey("marquee").texts, ["Free shipping", "Made by hand"]);
});

test("keeps every word in reading order as Markdown", () => {
  const c = byKey("slideshow").content.split("\n");
  assert.deepEqual(c, [
    "![Tan backpack](https://acme.example/cdn/shop/files/slide-1.jpg)",
    "### Carry it everywhere",
    "Full-grain leather that ages well.",
    "[Button: Shop backpacks](/collections/backpacks)",
    "![no description](https://acme.example/cdn/shop/t/5/assets/slide-2.jpg)",
    "### New: the weekender",
    "[Button: See the weekender](/products/weekender)",
  ]);
  assert.match(byKey("newsletter").content, /\[Email sign-up box\]/);
});

test("collects products, buttons and image sources", () => {
  const fc = byKey("featured_collection");
  assert.deepEqual(fc.productHandles, ["tan-backpack", "weekender", "old-wallet"]);
  assert.deepEqual(fc.buttons.map((b) => b.text), ["View all"]);
  assert.deepEqual(byKey("slideshow").images.map((i) => i.source), ["uploaded-file", "theme-file"]);
  assert.equal(fc.images[0].src, "https://cdn.shopify.com/s/files/1/0001/0002/files/tan-backpack-1.jpg");
});

test("reads store identity", () => {
  const id = parseIdentity(html, "https://acme.example/");
  assert.equal(id.name, "Acme Bags");
  assert.equal(id.shopDomain, "acme-bags.myshopify.com");
  assert.equal(id.currency, "INR");
  assert.equal(id.theme.name, "Dawn");
  assert.equal(id.theme.custom, false);
  assert.deepEqual(id.socialLinks, ["https://www.instagram.com/acmebags/", "https://www.facebook.com/"]);
  assert.deepEqual(id.contact.email, ["hello@acme.example"]);
  assert.deepEqual(id.navigation.map((n) => n.text), ["Shop all", "Backpacks", "About us"]);
  assert.equal(id.logo, "https://acme.example/cdn/shop/files/logo.png");
});

test("normalizes Shopify image URLs and classifies links", () => {
  assert.equal(normalizeImageUrl("//shop.com/cdn/shop/files/a_1600x.jpg?v=12"), "https://shop.com/cdn/shop/files/a.jpg");
  assert.equal(normalizeImageUrl("https://cdn.shopify.com/s/files/1/2/3/products/b_400x400_crop_center@2x.png"), "https://cdn.shopify.com/s/files/1/2/3/products/b.png");
  assert.equal(normalizeImageUrl("data:image/png;base64,xx"), null);
  assert.equal(imageSource("https://shop.com/cdn/shop/t/3/assets/hero.jpg", "shop.com"), "theme-file");
  assert.equal(imageSource("https://cdn.shopify.com/s/files/1/2/3/collections/c.jpg", "shop.com"), "collection");
  assert.equal(imageSource("https://images.example.org/x.jpg", "shop.com"), "external");
  assert.equal(linkKind("/collections/bags/products/tan", "shop.com"), "product");
  assert.equal(linkKind("/en-in/collections/bags", "shop.com"), "collection");
  assert.equal(linkKind("/blogs/news/hello", "shop.com"), "article");
  assert.equal(linkKind("https://www.shop.com/", "shop.com"), "home");
  assert.equal(linkKind("https://instagram.com/x", "shop.com"), "external");
});

test("turns rich text into readable lines with bullets", () => {
  assert.equal(htmlToMarkdown("<p>Soft leather.</p><ul><li>Laptop sleeve</li><li>Two <b>side</b> pockets</li></ul><h3>Care</h3><p>Wipe clean.<br>Keep dry.</p>"), "Soft leather.\n- Laptop sleeve\n- Two side pockets\n#### Care\nWipe clean.\nKeep dry.");
});
