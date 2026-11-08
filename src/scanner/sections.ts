// Turn raw section features into a role and a plain-language label a store owner understands.
import type { PageSection, SectionRole } from "./types.ts";

type Features = Pick<
  PageSection,
  "key" | "cssClass" | "group" | "headings" | "texts" | "buttons" | "images" | "videoCount" | "slideCount" | "productHandles" | "collectionHandles" | "hasEmailForm" | "linkCount"
> & { articleLinks: number; pageKind: string; firstTemplateSection: boolean };

const has = (s: string, re: RegExp) => re.test(s.toLowerCase());

export function inferRole(f: Features): SectionRole {
  // Ignore Shopify's generic wrapper classes (they mention "header-group"/"footer-group" for every section in the group).
  const id = `${f.key} ${f.cssClass.replace(/shopify-section(-group-[\w-]+)?/g, "")}`.toLowerCase();
  if (has(id, /cart[-_]?drawer|cart-notification|predictive|search-drawer|modal|popup/)) return "cart";
  if (has(id, /announce/)) return "announcement";
  if (f.group === "header" && has(id, /header|nav|menu/)) return "header";
  if (f.group === "footer" && has(id, /footer/)) return "footer";
  if (f.hasEmailForm && (has(id, /newsletter|subscribe|signup|email/) || f.headings.length <= 2)) return "newsletter";
  if (has(id, /marquee|scrolling|ticker|running-text/)) return "scrolling-text";
  if (f.pageKind === "product" && has(id, /main-product|product-template|product__info|section-product|^main/)) return "product-page";
  if (f.pageKind === "collection" && has(id, /main-collection|product-grid|collection-template/)) return "collection-page";
  if (has(id, /main-page|page-content|main-article|main-blog/)) return "page-content";
  if (has(id, /slide|carousel|slider|hero/) && f.slideCount > 1) return "hero-slider";
  if (has(id, /hero|image-banner|banner|slideshow/)) return f.slideCount > 1 ? "hero-slider" : "hero";
  if (has(id, /video|film|reel/) || (f.videoCount > 0 && f.headings.length <= 2)) return "video";
  if (has(id, /testimonial|review|quote/)) return "testimonials";
  if (has(id, /faq|accordion|collapsible/)) return "faq";
  if (has(id, /blog|journal|article|news/) || f.articleLinks >= 2) return "blog";
  if (has(id, /promise|trust|usp|benefit|feature-icons|icon|guarantee/)) return "trust-badges";
  if (f.productHandles.length >= 1 && has(id, /new[-_ ]?arrival|best[-_ ]?seller|featured[-_ ]?(collection|products)|product[-_ ]?(grid|list|row|carousel)|trending|lineup|recommend/)) return "product-grid";
  if (f.collectionHandles.length >= 2 && f.productHandles.length < 2) return "collection-list";
  const uniqueProducts = new Set(f.productHandles).size;
  if (uniqueProducts >= 3) return "product-grid";
  if (uniqueProducts >= 1 && f.images.length >= 2) return "product-spotlight";
  if (f.firstTemplateSection && f.images.length >= 1 && f.headings.length >= 1) return f.slideCount > 1 ? "hero-slider" : "hero";
  if (f.images.length >= 1 && (f.headings.length >= 1 || f.texts.length >= 1)) return "image-with-text";
  if (f.headings.length >= 3 && f.images.length === 0 && f.texts.length >= 2) return "trust-badges";
  if (f.headings.length || f.texts.length) return "text";
  return "other";
}

const ROLE_NAMES: Record<SectionRole, string> = {
  announcement: "Announcement strip",
  header: "Header & menu",
  "hero-slider": "Main banner slider",
  hero: "Main banner",
  "scrolling-text": "Scrolling text strip",
  "collection-list": "Collection tiles",
  "product-grid": "Product row",
  "product-spotlight": "Product spotlight",
  video: "Video",
  "image-with-text": "Image with text",
  "trust-badges": "Promises & trust badges",
  blog: "Blog posts",
  newsletter: "Newsletter sign-up",
  testimonials: "Customer reviews",
  faq: "Questions & answers",
  text: "Text block",
  footer: "Footer",
  "product-page": "Product details",
  "collection-page": "Collection product list",
  "page-content": "Page content",
  cart: "Cart drawer",
  other: "Section",
};

export function roleName(role: SectionRole): string {
  return ROLE_NAMES[role];
}

export function humanizeKey(key: string): string {
  const k = key.replace(/_[0-9a-f]{6,}$/i, "").replace(/[-_]+/g, " ").trim();
  return k ? k[0].toUpperCase() + k.slice(1) : "";
}

export function makeLabel(role: SectionRole, f: { headings: string[]; slideCount: number; texts: string[] }): string {
  let label = roleName(role);
  if (role === "hero-slider" && f.slideCount > 1) label += ` · ${f.slideCount} slides`;
  const first = f.headings.find((h) => h.length > 1 && h.length < 70);
  if (first && !["header", "footer", "cart"].includes(role)) label += ` — “${first}”`;
  return label;
}

export function slideCountFrom(classNames: string[], headings: number, images: number): number {
  // Count elements whose class looks like an individual slide (not the track/wrapper).
  const slides = classNames.filter((c) => /(^|[\s_-])(slide|swiper-slide|slideshow__slide|carousel__slide|carousel__item|slider__slide|hero__slide)($|[\s])/i.test(c) && !/slides|track|wrapper|container|nav|dot|button|arrow|counter|progress/i.test(c)).length;
  if (slides > 0) return slides;
  return headings > 1 && images >= headings ? headings : images > 0 || headings > 0 ? 1 : 0;
}
