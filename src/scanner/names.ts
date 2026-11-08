import type { PageKind, ScannedPage } from "./types.ts";

export const KIND_LABEL: Record<PageKind, string> = {
  home: "Homepage",
  collections: "All collections",
  collection: "Collection",
  product: "Product",
  page: "Page",
  blog: "Blog",
  article: "Blog post",
  other: "Page",
};

/** The page's own title without the " – Store name" suffix. */
export function shortTitle(p: Pick<ScannedPage, "title">, storeName = ""): string {
  let t = p.title.trim();
  if (storeName) t = t.replace(new RegExp(`\\s*[–—|-]\\s*${storeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$`, "i"), "");
  return t.replace(/\s*[–—|]\s*[^–—|]+$/, (m) => (t.length - m.length > 3 ? "" : m)).trim();
}

/** Plain-language page name, e.g. “Product: Heritage Flap Backpack”. */
export function pageName(p: Pick<ScannedPage, "kind" | "title">, storeName = ""): string {
  if (p.kind === "home") return "Homepage";
  if (p.kind === "collections") return "All collections";
  const t = shortTitle(p, storeName);
  return t ? `${KIND_LABEL[p.kind]}: ${t}` : KIND_LABEL[p.kind];
}
