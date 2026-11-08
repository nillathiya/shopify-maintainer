// The store snapshot: everything one scan learns, saved to local memory as a single document.

export type ImageSource = "theme-file" | "uploaded-file" | "product" | "collection" | "article" | "external" | "other";

export interface ImageRef {
  src: string; // absolute URL without size suffixes
  alt: string;
  source: ImageSource;
}

export type LinkKind = "product" | "collection" | "collections" | "page" | "blog" | "article" | "home" | "search" | "cart" | "account" | "external" | "other";

export interface LinkRef {
  href: string;
  text: string;
  kind: LinkKind;
  isButton: boolean;
}

export type SectionRole =
  | "announcement" | "header" | "hero-slider" | "hero" | "scrolling-text" | "collection-list" | "product-grid"
  | "product-spotlight" | "video" | "image-with-text" | "trust-badges" | "blog" | "newsletter" | "testimonials"
  | "faq" | "text" | "footer" | "product-page" | "collection-page" | "page-content" | "cart" | "other";

export interface SectionScreens {
  desktop?: string; // file name under data/screens
  mobile?: string;
  top?: number; // px from page top (desktop)
  height?: number;
  aboveFold?: boolean;
}

export interface PageSection {
  domId: string;
  key: string; // section key inside the template JSON, e.g. "hero"
  group: "header" | "footer" | "template" | "other";
  groupFile: string | null; // e.g. "sections/header-group.json" or "templates/index.json" when known
  position: number;
  cssClass: string;
  role: SectionRole;
  label: string; // plain-language name shown to the operator
  headings: string[];
  texts: string[];
  buttons: LinkRef[];
  linkCount: number;
  images: ImageRef[];
  videoCount: number;
  slideCount: number;
  productHandles: string[];
  collectionHandles: string[];
  hasEmailForm: boolean;
  hidden: boolean; // drawers, modals: present in HTML but not part of the page flow
  content: string; // every word of the section in reading order, as Markdown (headings, text, buttons, links, images)
  screens?: SectionScreens;
  editable?: EditableSlotRef[]; // filled by the admin scan
}

export interface EditableSlotRef {
  id: string;
  kind: string;
  setting: string;
  value: string;
  blockId: string | null;
}

export type PageKind = "home" | "collection" | "product" | "page" | "blog" | "article" | "collections" | "other";

export interface ScannedPage {
  kind: PageKind;
  url: string;
  status: number;
  title: string;
  metaDescription: string;
  h1: string[];
  canonical: string;
  ogImage: string;
  templateId: string | null;
  sections: PageSection[];
  fetchMs: number;
  bytes: number;
  screens?: { desktop?: string; mobile?: string };
  metrics?: PageMetrics;
}

export interface PageMetrics {
  loadMs: number;
  requests: number;
  transferBytes: number;
  failedRequests: string[];
  brokenImages: string[];
  consoleErrors: string[];
  mobileOverflowPx: number;
}

export interface StoreIdentity {
  url: string;
  name: string;
  shopDomain: string; // *.myshopify.com
  theme: { name: string; id: number | null; schemaName: string; schemaVersion: string; themeStoreId: number | null; custom: boolean };
  locale: string;
  currency: string;
  country: string;
  title: string;
  description: string;
  ogImage: string;
  favicon: string;
  logo: string;
  socialLinks: string[];
  contact: { email: string[]; phone: string[]; whatsapp: string[] };
  navigation: Array<{ text: string; href: string }>;
  passwordProtected: boolean;
}

export interface ProductVariant {
  id: number;
  title: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  available: boolean;
  options: string[];
}

export interface Product {
  id: number;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  tags: string[];
  descriptionText: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  options: Array<{ name: string; values: string[] }>;
  variants: ProductVariant[];
  images: Array<{ src: string; alt: string; width: number; height: number }>;
  collections: string[]; // handles
  priceMin: number;
  priceMax: number;
  available: boolean;
}

export interface Collection {
  id: number;
  handle: string;
  title: string;
  descriptionText: string;
  image: string;
  productsCount: number;
  productHandles: string[];
  updatedAt: string;
}

export interface ContentIndex {
  pages: Array<{ url: string; lastmod: string }>;
  blogs: Array<{ url: string; lastmod: string }>;
  articles: Array<{ url: string; lastmod: string }>;
}

export interface DesignTokens {
  colors: Array<{ value: string; uses: number; role: string }>;
  fonts: Array<{ family: string; role: string }>;
  cssColorVariables: Record<string, string>;
}

export type Severity = "high" | "medium" | "low" | "info";

export interface Finding {
  id: string; // stable across scans, used to tell new from resolved
  severity: Severity;
  area: "catalog" | "content" | "design" | "seo" | "links" | "setup" | "speed";
  title: string;
  detail: string;
  why: string;
  items?: Array<{ label: string; url?: string }>;
}

export interface AdminScan {
  themeId: string;
  themeName: string;
  fileCount: number;
  templates: string[];
  editableSlotCount: number;
  palette: string[];
  fonts: string[];
  /** Theme-file images referenced from section code: asset filename → section files that use it. */
  hardcodedImages: Record<string, string[]>;
}

export interface StoreSnapshot {
  version: 1;
  scannedAt: string;
  durationMs: number;
  identity: StoreIdentity;
  pages: ScannedPage[];
  products: Product[];
  collections: Collection[];
  content: ContentIndex;
  design: DesignTokens | null;
  admin: AdminScan | null;
  findings: Finding[];
  stats: Record<string, number>;
  warnings: string[];
}
