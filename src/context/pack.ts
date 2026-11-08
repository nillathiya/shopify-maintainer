// The store context pack: a self-contained folder that describes the whole store in words
// and pictures. Any person or AI model can read it and continue from where the last scan
// left off, without scanning again.
//
//   STORE.md              overview + how to use the folder (start here)
//   manifest.json         list of every file with titles and URLs
//   snapshot.json         everything in structured form
//   pages/<slug>.md       every word of every page, section by section, with picture links
//   catalog/products/*.md every product in full (also products.json / collections.json)
//   screens/*.jpg         full-page and per-section pictures, computer and phone
//   NOTES.md              owner/assistant notes, kept between scans
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Product, ScannedPage, StoreSnapshot } from "../scanner/types.ts";
import type { Change } from "../scanner/diff.ts";
import { pageName } from "../scanner/names.ts";
import { pageSlug } from "../scanner/visual.ts";

export const PACK_SCHEMA_VERSION = 1;

export interface ManifestFile {
  path: string;
  type: "overview" | "notes" | "data" | "page" | "product" | "screenshot";
  title: string;
  url?: string;
  bytes?: number;
}

export interface Manifest {
  generator: string;
  schemaVersion: number;
  scanId: string;
  scannedAt: string;
  store: { name: string; url: string; shopDomain: string; theme: string };
  entry: string;
  files: ManifestFile[];
}

export const NOTES_TEMPLATE = `# Notes

Anything written here is kept between scans. Use it for decisions, brand rules,
things to avoid, and what was changed and why. AI assistants should read this file
together with STORE.md, and add to it instead of guessing.
`;

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const money = (n: number, cur: string) => `${cur} ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtRange = (a: number, b: number, cur: string) => (a === b ? money(a, cur) : `${money(a, cur)} – ${money(b, cur)}`);

export function productSlug(p: Product) {
  return `catalog/products/${p.handle.replace(/[^\w.-]+/g, "-")}.md`;
}

function shot(file: string | undefined): string {
  return file ? `screens/${file}` : "";
}

export function pageMarkdown(p: ScannedPage, snap: StoreSnapshot, fromDir = "pages"): string {
  const up = fromDir ? "../" : "";
  const L: string[] = [];
  L.push(`# ${pageName(p, snap.identity.name)}`, "");
  L.push(`- Address: ${p.url}`);
  L.push(`- Kind: ${p.kind}${p.status !== 200 ? ` (answered with error ${p.status})` : ""}`);
  L.push(`- Browser title: ${p.title || "(none)"}`);
  L.push(`- Search description: ${p.metaDescription || "(none)"}`);
  if (p.h1.length) L.push(`- Main heading(s): ${p.h1.join(" / ")}`);
  if (p.screens?.desktop || p.screens?.mobile)
    L.push(`- Pictures: ${[p.screens.desktop && `[computer](${up}${shot(p.screens.desktop)})`, p.screens.mobile && `[phone](${up}${shot(p.screens.mobile)})`].filter(Boolean).join(", ")}`);
  if (p.metrics) L.push(`- Measured: loaded in ${(p.metrics.loadMs / 1000).toFixed(1)}s, ${(p.metrics.transferBytes / 1e6).toFixed(1)} MB, ${p.metrics.requests} requests`);
  L.push("");
  const visible = p.sections.filter((s) => !s.hidden);
  visible.forEach((s, i) => {
    const sharedNote = s.group !== "template" && p.kind !== "home" ? " (same on every page — see Homepage)" : "";
    L.push(`## ${i + 1}. ${s.label}${sharedNote}`, "");
    const meta = [`section key \`${s.key}\``, s.groupFile ? `stored in \`${s.groupFile}\`` : "", `role: ${s.role}`];
    if (s.screens?.top !== undefined) meta.push(`at ${s.screens.top}px from the top, ${s.screens.height}px tall${s.screens.aboveFold ? ", visible without scrolling" : ""}`);
    L.push(`_${meta.filter(Boolean).join(" · ")}_`, "");
    if (s.screens?.desktop || s.screens?.mobile)
      L.push(`Pictures: ${[s.screens.desktop && `[computer](${up}${shot(s.screens.desktop)})`, s.screens.mobile && `[phone](${up}${shot(s.screens.mobile)})`].filter(Boolean).join(", ")}`, "");
    if (s.images.length) {
      const bySource = s.images.reduce<Record<string, number>>((a, im) => ((a[im.source] = (a[im.source] ?? 0) + 1), a), {});
      L.push(`Images: ${Object.entries(bySource).map(([k, n]) => `${n} ${k.replace("-", " ")}`).join(", ")}`, "");
    }
    if (s.editable?.length) {
      L.push("Editable in the theme editor:", ...s.editable.map((e) => `- \`${e.setting}\`${e.blockId ? ` (block ${e.blockId})` : ""} [${e.kind}]: ${esc(e.value).slice(0, 160)}`), "");
    }
    if (!sharedNote) L.push(s.content || "_(no text)_", "");
  });
  return L.join("\n");
}

export function productMarkdown(p: Product, snap: StoreSnapshot): string {
  const cur = snap.identity.currency;
  const L = [`# ${p.title}`, ""];
  L.push(`- Address: ${snap.identity.url}/products/${p.handle}`);
  L.push(`- Price: ${fmtRange(p.priceMin, p.priceMax, cur)}${p.available ? "" : " · SOLD OUT"}`);
  if (p.productType) L.push(`- Type: ${p.productType}`);
  if (p.vendor) L.push(`- Brand/vendor: ${p.vendor}`);
  if (p.tags.length) L.push(`- Tags: ${p.tags.join(", ")}`);
  L.push(`- Collections: ${p.collections.join(", ") || "(none)"}`);
  L.push(`- Published: ${p.publishedAt?.slice(0, 10) ?? "?"} · last updated ${p.updatedAt?.slice(0, 10) ?? "?"}`, "");
  if (p.options.length) L.push("## Options", ...p.options.map((o) => `- ${o.name}: ${o.values.join(", ")}`), "");
  L.push("## Variants", "", "| Variant | SKU | Price | Was | In stock |", "|---|---|---|---|---|");
  for (const v of p.variants) L.push(`| ${esc(v.title)} | ${esc(v.sku || "—")} | ${v.price} | ${v.compareAtPrice ?? "—"} | ${v.available ? "yes" : "no"} |`);
  L.push("", "## Description", "", p.descriptionText || "_(no description)_", "");
  L.push("## Photos", "", ...p.images.map((im, i) => `${i + 1}. ![${im.alt || "no description"}](${im.src}) — ${im.width}×${im.height}${im.alt ? "" : " — no alt text"}`), "");
  return L.join("\n");
}

export function storeMarkdown(snap: StoreSnapshot, changes: Change[], scanId: string, pageFiles: Map<ScannedPage, string>): string {
  const id = snap.identity;
  const cur = id.currency;
  const L: string[] = [];
  L.push(`# Store context: ${id.name || id.url}`, "");
  L.push(`> Written by shopify-maintainer from a scan on ${snap.scannedAt.replace("T", " ").slice(0, 16)} UTC (scan \`${scanId}\`). It is a complete, offline description of the store's public pages in words and pictures. Treat it as the current state of the store until the owner asks for a new scan.`, "");
  L.push("## How to use this folder", "");
  L.push("- **Start here.** This file summarises the whole store. Read `NOTES.md` next for the owner's decisions and rules.");
  L.push("- **Exact wording** of any page is in `pages/`, section by section, in the order shoppers see it. Products in full are in `catalog/products/`.");
  L.push("- **What it looks like:** `screens/` has a full-page picture of every page on computer (1440px wide) and phone (390px wide), plus one picture per section.");
  L.push("- `manifest.json` lists every file; `snapshot.json` holds all data in structured form for programs.");
  L.push("- Section keys (like `hero`) and file names (like `templates/index.json`) are the names Shopify uses, so changes can be targeted exactly.", "");

  L.push("## The store", "", "| | |", "|---|---|");
  const rows: Array<[string, string]> = [
    ["Address", id.url],
    ["Shopify domain", id.shopDomain || "?"],
    ["Theme", `${id.theme.name}${id.theme.schemaName ? ` (${id.theme.schemaName} v${id.theme.schemaVersion})` : ""}${id.theme.custom ? " — custom-made, not from the Theme Store" : ""}`],
    ["Currency / country / language", `${id.currency} / ${id.country} / ${id.locale}`],
    ["Browser title", id.title],
    ["Search description", id.description],
    ["Social links", id.socialLinks.join(", ") || "(none)"],
    ["Contact links", [...id.contact.email, ...id.contact.phone, ...id.contact.whatsapp].join(", ") || "(none)"],
    ["Counts", `${snap.stats.products} products (${snap.stats.variants} variants, ${snap.stats.productPhotos} photos), ${snap.stats.collections} collections, ${snap.stats.pages} pages, ${snap.stats.articles} blog posts`],
  ];
  for (const [k, v] of rows) L.push(`| ${k} | ${esc(v)} |`);
  L.push("");

  if (id.navigation.length) L.push("## Main menu", "", ...id.navigation.map((n) => `- ${n.text} → ${n.href}`), "");

  if (snap.design || snap.admin) {
    L.push("## Look and feel", "");
    if (snap.design) {
      L.push(`- Main colours: ${snap.design.colors.map((c) => `${c.value} (${c.role})`).join(", ")}`);
      L.push(`- Fonts: ${snap.design.fonts.map((f) => `${f.family} (${f.role})`).join(", ")}`);
      const vars = Object.entries(snap.design.cssColorVariables).slice(0, 24);
      if (vars.length) L.push(`- Theme colour variables: ${vars.map(([k, v]) => `\`${k}: ${v}\``).join(", ")}`);
    }
    if (snap.admin) L.push(`- Theme settings palette: ${snap.admin.palette.join(", ")}`, `- Theme settings fonts: ${snap.admin.fonts.join(", ")}`);
    const home = snap.pages.find((p) => p.kind === "home");
    if (home?.screens?.desktop) L.push(`- Homepage pictures: [computer](screens/${home.screens.desktop})${home.screens.mobile ? `, [phone](screens/${home.screens.mobile})` : ""}`);
    L.push("");
  }

  const home = snap.pages.find((p) => p.kind === "home");
  if (home) {
    L.push("## Homepage, top to bottom", "", `Full wording: [${pageFiles.get(home)}](${pageFiles.get(home)})`, "");
    home.sections.filter((s) => !s.hidden).forEach((s, i) => {
      const pics = [s.screens?.desktop && `[computer](screens/${s.screens.desktop})`, s.screens?.mobile && `[phone](screens/${s.screens.mobile})`].filter(Boolean).join(" ");
      const imgs = s.images.length ? ` · ${s.images.length} image(s)${s.images.some((x) => x.source === "theme-file") ? ", some stored in theme files" : ""}` : "";
      L.push(`${i + 1}. **${s.label}** — key \`${s.key}\`${s.groupFile ? ` in \`${s.groupFile}\`` : ""}${imgs}${pics ? ` · ${pics}` : ""}`);
      const gist = [...s.headings.slice(0, 3), ...s.buttons.slice(0, 3).map((b) => `[${b.text}]`)].join(" · ");
      if (gist) L.push(`   ${esc(gist).slice(0, 300)}`);
    });
    L.push("");
  }

  const kinds = [...new Set(snap.pages.map((p) => p.kind))].filter((k) => k !== "home");
  if (kinds.length) {
    L.push("## Page layouts", "", "The sections each kind of page uses (from the first page of that kind):", "");
    for (const k of kinds) {
      const p = snap.pages.find((x) => x.kind === k)!;
      L.push(`- **${pageName({ kind: k, title: "" })}**: ${p.sections.filter((s) => !s.hidden && s.group === "template").map((s) => `${s.label.split(" — ")[0]} (\`${s.key}\`)`).join(" → ") || "(no sections)"}`);
    }
    L.push("");
  }

  L.push("## Products", "", "| Product | Price | Variants | Photos | In stock | Collections | Details |", "|---|---|---|---|---|---|---|");
  for (const p of snap.products) L.push(`| ${esc(p.title)} | ${fmtRange(p.priceMin, p.priceMax, cur)} | ${p.variants.length} | ${p.images.length} | ${p.available ? "yes" : "no"} | ${esc(p.collections.join(", "))} | [${productSlug(p)}](${productSlug(p)}) |`);
  L.push("");
  L.push("## Collections", "", "| Collection | Products | Cover image | Description |", "|---|---|---|---|");
  for (const c of snap.collections) L.push(`| ${esc(c.title)} (\`${c.handle}\`) | ${c.productsCount} | ${c.image ? "yes" : "no"} | ${esc(c.descriptionText).slice(0, 120) || "—"} |`);
  L.push("");

  L.push("## Every page scanned", "");
  for (const p of snap.pages) L.push(`- [${pageName(p, id.name)}](${pageFiles.get(p)}) — ${p.url}${p.status !== 200 ? ` (error ${p.status})` : ""}`);
  L.push("");

  L.push("## Health check", "");
  if (!snap.findings.length) L.push("No issues found.");
  for (const f of snap.findings) {
    L.push(`- **[${f.severity}] ${f.title}** — ${f.detail}`);
    for (const it of (f.items ?? []).slice(0, 8)) L.push(`  - ${it.label}`);
    if ((f.items?.length ?? 0) > 8) L.push(`  - …and ${f.items!.length - 8} more`);
  }
  L.push("");
  if (changes.length) L.push("## Changes since the previous scan", "", ...changes.map((c) => `- ${c.text}`), "");
  if (snap.warnings.length) L.push("## Scan notes", "", ...snap.warnings.map((w) => `- ${w}`), "");
  return L.join("\n");
}

/** Write the full pack into `dir` (screens/ is expected to already be there). */
export function writePack(dir: string, snap: StoreSnapshot, changes: Change[], scanId: string, notes: string | null): Manifest {
  mkdirSync(path.join(dir, "pages"), { recursive: true });
  mkdirSync(path.join(dir, "catalog", "products"), { recursive: true });
  const files: ManifestFile[] = [];
  const put = (rel: string, body: string, f: Omit<ManifestFile, "path" | "bytes">) => {
    writeFileSync(path.join(dir, rel), body);
    files.push({ path: rel, bytes: Buffer.byteLength(body), ...f });
  };

  const pageFiles = new Map<ScannedPage, string>();
  const used = new Set<string>();
  for (const p of snap.pages) {
    let rel = `pages/${pageSlug(p)}.md`;
    for (let n = 2; used.has(rel); n++) rel = `pages/${pageSlug(p)}-${n}.md`;
    used.add(rel);
    pageFiles.set(p, rel);
  }

  put("STORE.md", storeMarkdown(snap, changes, scanId, pageFiles), { type: "overview", title: "Store overview — start here" });
  put("NOTES.md", notes ?? NOTES_TEMPLATE, { type: "notes", title: "Owner & assistant notes (kept between scans)" });
  for (const p of snap.pages) put(pageFiles.get(p)!, pageMarkdown(p, snap), { type: "page", title: pageName(p, snap.identity.name), url: p.url });
  for (const p of snap.products) put(productSlug(p), productMarkdown(p, snap), { type: "product", title: p.title, url: `${snap.identity.url}/products/${p.handle}` });
  put("catalog/products.json", JSON.stringify(snap.products, null, 1), { type: "data", title: "All products (structured)" });
  put("catalog/collections.json", JSON.stringify(snap.collections, null, 1), { type: "data", title: "All collections (structured)" });
  put("snapshot.json", JSON.stringify(snap), { type: "data", title: "Full scan data (structured)" });

  const screens = path.join(dir, "screens");
  if (existsSync(screens)) {
    for (const f of readdirSync(screens).sort()) files.push({ path: `screens/${f}`, type: "screenshot", title: f.replace(/\.jpg$/, ""), bytes: statSync(path.join(screens, f)).size });
  }

  const manifest: Manifest = {
    generator: "shopify-maintainer",
    schemaVersion: PACK_SCHEMA_VERSION,
    scanId,
    scannedAt: snap.scannedAt,
    store: { name: snap.identity.name, url: snap.identity.url, shopDomain: snap.identity.shopDomain, theme: snap.identity.theme.name },
    entry: "STORE.md",
    files,
  };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
