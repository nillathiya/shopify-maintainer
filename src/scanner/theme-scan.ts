// Deterministic theme scan: no AI needed. Turns the JSON templates into an inventory of
// editable "slots" (headings, text, images, buttons, links) grouped by marketing surface.
import { parseThemeJson } from "./theme-json.ts";

export type SlotKind = "image" | "heading" | "text" | "richtext" | "button" | "link" | "video";
export type Surface = "announcement" | "slider" | "hero" | "promo" | "collection" | "product" | "footer" | "header" | "content";

export interface Slot {
  id: string; // `${file}#${sectionId}/${blockId|-}/${setting}`
  file: string;
  path: string[]; // JSON path inside the file
  kind: SlotKind;
  sectionId: string;
  sectionType: string;
  blockId: string | null;
  blockType: string | null;
  setting: string;
  value: string;
  surface: Surface;
  disabled: boolean;
}

export interface SectionSummary {
  file: string;
  sectionId: string;
  type: string;
  surface: Surface;
  disabled: boolean;
  blockCount: number;
  blockTypes: string[];
  position: number;
}

export interface ThemeMap {
  slots: Slot[];
  sections: SectionSummary[];
  palette: string[];
  fonts: string[];
}

export const SCANNED_FILE_PATTERNS = ["templates/*.json", "sections/*.json", "config/settings_data.json"];

export function slotId(file: string, sectionId: string, blockId: string | null, setting: string): string {
  return `${file}#${sectionId}/${blockId ?? "-"}/${setting}`;
}

export function surfaceFor(sectionType: string, file: string): Surface {
  const t = sectionType.toLowerCase();
  if (/announcement/.test(t)) return "announcement";
  if (/slide|carousel|slider/.test(t)) return "slider";
  if (/hero|image-banner|banner|video-hero|split-hero/.test(t)) return "hero";
  if (/promo|countdown|image-with-text|collage|offer|sale|marquee|scrolling-text/.test(t)) return "promo";
  if (/collection/.test(t)) return "collection";
  if (/product/.test(t)) return "product";
  if (/footer/.test(t) || /footer-group/.test(file)) return "footer";
  if (/header/.test(t) || /header-group/.test(file)) return "header";
  return "content";
}

export function classifySetting(key: string, value: unknown): SlotKind | null {
  if (typeof value !== "string") return null;
  const k = key.toLowerCase();
  if (value.startsWith("shopify://shop_images/") || /(^|_)(image|img|picture|background_image|banner)(_|$|\d)/.test(k)) {
    return /color|position|ratio|height|size|width|overlay|opacity|behavior|style|fit|alignment|layout/.test(k) ? null : "image";
  }
  if (/video/.test(k) && !/autoplay|loop|style/.test(k)) return value.startsWith("http") || value.startsWith("shopify://") ? "video" : null;
  if (/(link|url|href)/.test(k)) return /label|text|style/.test(k) ? "button" : "link";
  if (/button.*(label|text)|(label|text).*button|^cta|_cta/.test(k)) return "button";
  if (/^<(p|h\d|ul|ol|div|strong|em)[\s>]/i.test(value.trim())) return "richtext";
  if (/(subheading|sub_heading|subtitle|sub_title)/.test(k) && !/size|color|style|alignment|position/.test(k)) return "text";
  if (/(heading|title|headline|eyebrow|kicker)/.test(k) && !/size|color|tag|style|alignment|position/.test(k)) return "heading";
  if (/(subheading|subtitle|caption|text|description|message|announcement|content|tagline|label)/.test(k) && !/size|color|style|alignment|position|transform|case/.test(k)) return "text";
  return null;
}

function collectSettings(
  out: Slot[],
  file: string,
  basePath: string[],
  settings: Record<string, unknown> | undefined,
  ctx: { sectionId: string; sectionType: string; blockId: string | null; blockType: string | null; surface: Surface; disabled: boolean },
): void {
  if (!settings || typeof settings !== "object") return;
  for (const [key, value] of Object.entries(settings)) {
    const kind = classifySetting(key, value);
    if (!kind) continue;
    out.push({
      id: slotId(file, ctx.sectionId, ctx.blockId, key),
      file,
      path: [...basePath, key],
      kind,
      sectionId: ctx.sectionId,
      sectionType: ctx.sectionType,
      blockId: ctx.blockId,
      blockType: ctx.blockType,
      setting: key,
      value: String(value),
      surface: ctx.surface,
      disabled: ctx.disabled,
    });
  }
}

/** Scan one template / section-group file. */
export function scanTemplate(file: string, doc: any): { slots: Slot[]; sections: SectionSummary[] } {
  const slots: Slot[] = [];
  const sections: SectionSummary[] = [];
  const secs = doc?.sections;
  if (!secs || typeof secs !== "object") return { slots, sections };
  const order: string[] = Array.isArray(doc.order) ? doc.order : Object.keys(secs);
  order.forEach((sectionId, position) => {
    const s = secs[sectionId];
    if (!s || typeof s !== "object") return;
    const type = String(s.type ?? "unknown");
    const surface = surfaceFor(type, file);
    const disabled = Boolean(s.disabled);
    collectSettings(slots, file, ["sections", sectionId, "settings"], s.settings, { sectionId, sectionType: type, blockId: null, blockType: null, surface, disabled });
    const blocks = s.blocks && typeof s.blocks === "object" ? s.blocks : {};
    const blockOrder: string[] = Array.isArray(s.block_order) ? s.block_order : Object.keys(blocks);
    for (const blockId of blockOrder) {
      const b = blocks[blockId];
      if (!b) continue;
      collectSettings(slots, file, ["sections", sectionId, "blocks", blockId, "settings"], b.settings, {
        sectionId, sectionType: type, blockId, blockType: String(b.type ?? "block"), surface, disabled: disabled || Boolean(b.disabled),
      });
    }
    sections.push({ file, sectionId, type, surface, disabled, blockCount: blockOrder.length, blockTypes: [...new Set(blockOrder.map((id) => String(blocks[id]?.type ?? "")))], position });
  });
  return { slots, sections };
}

/** Pull the brand palette and fonts out of config/settings_data.json. */
export function scanGlobalSettings(doc: any): { palette: string[]; fonts: string[] } {
  const current = typeof doc?.current === "string" ? doc.presets?.[doc.current] ?? {} : doc?.current ?? {};
  const colors = new Set<string>();
  const fonts = new Set<string>();
  const visit = (v: unknown, key = "") => {
    if (typeof v === "string") {
      if (/^#[0-9a-f]{3,8}$/i.test(v)) colors.add(v.toLowerCase());
      if (/font/i.test(key) && /_[ni]\d$/.test(v)) fonts.add(v.replace(/_[ni]\d$/, "").replace(/_/g, " "));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) visit(x, k);
    }
  };
  visit(current);
  return { palette: [...colors].slice(0, 16), fonts: [...fonts] };
}

/** Build the full theme map from raw file contents. */
export function buildThemeMap(files: Array<{ filename: string; content: string | null }>): ThemeMap {
  const map: ThemeMap = { slots: [], sections: [], palette: [], fonts: [] };
  for (const f of files) {
    if (!f.content || !f.filename.endsWith(".json")) continue;
    let doc: any;
    try {
      doc = parseThemeJson(f.content).doc;
    } catch {
      continue; // malformed or non-template JSON; skip rather than fail the scan
    }
    if (f.filename === "config/settings_data.json") {
      Object.assign(map, scanGlobalSettings(doc));
      continue;
    }
    const { slots, sections } = scanTemplate(f.filename, doc);
    map.slots.push(...slots);
    map.sections.push(...sections);
  }
  return map;
}
