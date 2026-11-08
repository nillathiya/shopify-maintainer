import { test } from "node:test";
import assert from "node:assert/strict";
import { buildThemeMap, classifySetting } from "../src/scanner/theme-scan.ts";
import { parseThemeJson, stringifyThemeJson } from "../src/scanner/theme-json.ts";

const indexJson = `/*
 * ------------------------------------------------------------
 * IMPORTANT: The contents of this file are auto-generated.
 * ------------------------------------------------------------
 */
{
  "sections": {
    "hero": {
      "type": "slideshow",
      "settings": { "auto_rotate": true, "slide_height": "large" },
      "blocks": {
        "slide_1": { "type": "slide", "settings": { "image": "shopify://shop_images/hero-1.jpg", "heading": "Carry it everywhere", "subheading": "Full-grain leather", "button_label": "Shop now", "link": "shopify://collections/backpacks", "text_alignment": "center" } },
        "slide_2": { "type": "slide", "disabled": true, "settings": { "image": "", "heading": "Old offer" } }
      },
      "block_order": ["slide_1", "slide_2"]
    },
    "text": { "type": "rich-text", "settings": { "text": "<p>Made in <strong>Jaipur</strong></p>", "heading_size": "h2" } }
  },
  "order": ["hero", "text"]
}`;

test("parses theme JSON with Shopify's comment header and writes it back unchanged", () => {
  const parsed = parseThemeJson(indexJson);
  assert.equal(parsed.doc.order[0], "hero");
  assert.ok(stringifyThemeJson(parsed).startsWith("/*"));
});

test("extracts editable texts and images, skipping layout settings", () => {
  const map = buildThemeMap([
    { filename: "templates/index.json", content: indexJson },
    { filename: "config/settings_data.json", content: JSON.stringify({ current: { colors_accent_1: "#DB211C", type_header_font: "anton_n4", colors_text: "#111111" } }) },
  ]);
  const ids = map.slots.map((s) => `${s.sectionId}/${s.blockId ?? "-"}/${s.setting}:${s.kind}`);
  assert.deepEqual(ids, [
    "hero/slide_1/image:image",
    "hero/slide_1/heading:heading",
    "hero/slide_1/subheading:text",
    "hero/slide_1/button_label:button",
    "hero/slide_1/link:link",
    "hero/slide_2/image:image",
    "hero/slide_2/heading:heading",
    "text/-/text:richtext",
  ]);
  assert.equal(map.slots.find((s) => s.blockId === "slide_2")!.disabled, true);
  assert.equal(map.sections[0].surface, "slider");
  assert.deepEqual(map.palette, ["#db211c", "#111111"]);
  assert.deepEqual(map.fonts, ["anton"]);
});

test("classifies setting names", () => {
  assert.equal(classifySetting("image_overlay_opacity", "40"), null);
  assert.equal(classifySetting("heading_size", "h1"), null);
  assert.equal(classifySetting("announcement", "Free shipping"), "text");
  assert.equal(classifySetting("cta_label", "Buy"), "button");
});
