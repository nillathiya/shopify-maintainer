// Health check: turns a snapshot into plain-language findings an owner can act on.
// Every finding has a stable id so we can tell "new" from "fixed" between scans.
import type { Finding, StoreSnapshot } from "./types.ts";
import type { LinkCheck } from "./storefront.ts";
import { pageName } from "./names.ts";

const SEASONAL = /\b(diwali|deepavali|holi|eid|ramadan|navratri|dussehra|rakhi|raksha bandhan|christmas|xmas|new year|valentine|black friday|cyber monday|boxing day|halloween|easter|mother'?s day|father'?s day|independence day|republic day|summer sale|winter sale|monsoon sale|festive sale|end of season)\b/i;
const short = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function analyze(snap: StoreSnapshot, links: LinkCheck[] = [], today = new Date()): Finding[] {
  const f: Finding[] = [];
  const base = snap.identity.url;
  const productUrl = (h: string) => `${base}/products/${h}`;
  const add = (x: Finding) => f.push(x);
  const products = snap.products;

  // ── Catalog ──
  const noImages = products.filter((p) => p.images.length === 0);
  if (noImages.length)
    add({ id: "catalog.no-images", severity: "high", area: "catalog", title: `${noImages.length} product${noImages.length > 1 ? "s have" : " has"} no photos`, detail: "Products without photos rarely sell and look broken in collection pages.", why: "Shoppers decide mostly from photos.", items: noImages.map((p) => ({ label: p.title, url: productUrl(p.handle) })) });
  const onePhoto = products.filter((p) => p.images.length === 1);
  if (onePhoto.length)
    add({ id: "catalog.one-image", severity: "low", area: "catalog", title: `${onePhoto.length} product${onePhoto.length > 1 ? "s have" : " has"} only one photo`, detail: "Adding a few more angles (back, inside, in use) usually helps people decide.", why: "More photos answer questions before they're asked.", items: onePhoto.map((p) => ({ label: p.title, url: productUrl(p.handle) })) });
  const thinDesc = products.filter((p) => p.descriptionText.length < 150);
  if (thinDesc.length)
    add({ id: "catalog.thin-description", severity: "medium", area: "catalog", title: `${thinDesc.length} product${thinDesc.length > 1 ? "s have" : " has"} a very short description`, detail: "Descriptions under ~150 characters. Mention material, size, what fits inside, and care.", why: "Good descriptions help search engines and reduce returns.", items: thinDesc.map((p) => ({ label: `${p.title} (${p.descriptionText.length} characters)`, url: productUrl(p.handle) })) });
  const missingAlt = products.flatMap((p) => p.images.filter((i) => !i.alt).map(() => p)).length;
  const totalImages = products.reduce((a, p) => a + p.images.length, 0);
  if (missingAlt && totalImages)
    add({ id: "seo.missing-alt", severity: missingAlt / totalImages > 0.5 ? "medium" : "low", area: "seo", title: `${missingAlt} of ${totalImages} product photos have no description (alt text)`, detail: "Alt text is a short description of a photo, e.g. “Cognac leather backpack, front view”.", why: "It's read aloud to blind shoppers and helps Google Images find you.", items: products.filter((p) => p.images.some((i) => !i.alt)).map((p) => ({ label: `${p.title}: ${p.images.filter((i) => !i.alt).length} photo(s)`, url: productUrl(p.handle) })) });
  const soldOut = products.filter((p) => !p.available);
  if (soldOut.length)
    add({ id: "catalog.sold-out", severity: "medium", area: "catalog", title: `${soldOut.length} product${soldOut.length > 1 ? "s are" : " is"} completely sold out`, detail: "Restock, or hide them if they won't come back.", why: "Sold-out items in prominent places frustrate shoppers.", items: soldOut.map((p) => ({ label: p.title, url: productUrl(p.handle) })) });
  const badSale = products.filter((p) => p.variants.some((v) => v.compareAtPrice && parseFloat(v.compareAtPrice) > 0 && parseFloat(v.compareAtPrice) <= parseFloat(v.price)));
  if (badSale.length)
    add({ id: "catalog.compare-price", severity: "medium", area: "catalog", title: `${badSale.length} product${badSale.length > 1 ? "s have" : " has"} a “was” price that isn't higher than the price`, detail: "The crossed-out price should be higher than the selling price, otherwise the sale badge is misleading.", why: "Misleading prices erode trust.", items: badSale.map((p) => ({ label: p.title, url: productUrl(p.handle) })) });
  const noSku = products.filter((p) => p.variants.some((v) => !v.sku));
  if (noSku.length)
    add({ id: "catalog.no-sku", severity: "low", area: "catalog", title: `${noSku.length} product${noSku.length > 1 ? "s have" : " has"} options without a SKU code`, detail: "SKUs make stock counting, shipping labels and marketplaces much easier.", why: "Helps operations, not shoppers.", items: noSku.map((p) => ({ label: p.title, url: productUrl(p.handle) })) });
  if (snap.collections.length) {
    const orphan = products.filter((p) => p.collections.length === 0 || p.collections.every((c) => c === "all" || c === "frontpage"));
    if (orphan.length)
      add({ id: "catalog.not-in-collection", severity: "medium", area: "catalog", title: `${orphan.length} product${orphan.length > 1 ? "s aren't" : " isn't"} in any collection`, detail: "They can only be found through search or a direct link.", why: "Collections are how most shoppers browse.", items: orphan.map((p) => ({ label: p.title, url: productUrl(p.handle) })) });
  }
  const dupTitles = Object.entries(products.reduce<Record<string, number>>((a, p) => ((a[p.title.toLowerCase()] = (a[p.title.toLowerCase()] ?? 0) + 1), a), {})).filter(([, n]) => n > 1);
  if (dupTitles.length)
    add({ id: "catalog.duplicate-titles", severity: "low", area: "seo", title: `${dupTitles.length} product name${dupTitles.length > 1 ? "s are" : " is"} used more than once`, detail: "Products with identical names compete with each other in search.", why: "Unique names are clearer for shoppers and Google.", items: dupTitles.map(([t, n]) => ({ label: `“${t}” × ${n}` })) });

  const emptyCols = snap.collections.filter((c) => c.productsCount === 0);
  if (emptyCols.length)
    add({ id: "catalog.empty-collections", severity: "medium", area: "catalog", title: `${emptyCols.length} collection${emptyCols.length > 1 ? "s are" : " is"} empty`, detail: "Empty collections lead shoppers to a blank page.", why: "Dead ends make people leave.", items: emptyCols.map((c) => ({ label: c.title, url: `${base}/collections/${c.handle}` })) });
  const noColImg = snap.collections.filter((c) => !c.image && c.productsCount > 0);
  if (noColImg.length)
    add({ id: "catalog.collection-no-image", severity: "low", area: "catalog", title: `${noColImg.length} collection${noColImg.length > 1 ? "s have" : " has"} no cover image`, detail: "The cover image shows on collection lists and when links are shared.", why: "A consistent set of covers makes the store look finished.", items: noColImg.map((c) => ({ label: c.title, url: `${base}/collections/${c.handle}` })) });
  const noColDesc = snap.collections.filter((c) => c.descriptionText.length < 40 && c.productsCount > 0);
  if (noColDesc.length)
    add({ id: "seo.collection-description", severity: "low", area: "seo", title: `${noColDesc.length} collection${noColDesc.length > 1 ? "s have" : " has"} little or no description`, detail: "A couple of sentences per collection helps search engines understand the page.", why: "Collection pages are often what people land on from Google.", items: noColDesc.map((c) => ({ label: c.title, url: `${base}/collections/${c.handle}` })) });

  // ── Content on the pages we visited ──
  const home = snap.pages.find((p) => p.kind === "home");
  const year = today.getFullYear();
  // Header/footer repeat on every page: only count them once (on the homepage).
  const visibleText = (p: typeof home) => (p ? p.sections.filter((s) => !s.hidden && (p.kind === "home" || s.group === "template")).flatMap((s) => [...s.headings, ...s.texts, ...s.buttons.map((b) => b.text)]) : []);
  const oldYear = (t: string) => [...t.matchAll(/\b(20\d{2})\b/g)].some((m) => Number(m[1]) < year && Number(m[1]) > 2000);
  const staleYears = snap.pages.filter((p) => p.kind !== "article").flatMap((p) => visibleText(p).filter(oldYear).map((t) => ({ label: `${pageName(p, snap.identity.name)}: ${short(t)}`, url: p.url })));
  if (staleYears.length)
    add({ id: "content.old-year", severity: "medium", area: "content", title: `A past year is mentioned ${staleYears.length} time${staleYears.length > 1 ? "s" : ""}`, detail: "Old years in banners and headings make a store look abandoned (blog posts are ignored).", why: "Freshness builds trust.", items: staleYears.slice(0, 30) });
  const seasonal = snap.pages.flatMap((p) => visibleText(p).filter((t) => SEASONAL.test(t)).map((t) => ({ label: `${pageName(p, snap.identity.name)}: ${short(t)}`, url: p.url })));
  if (seasonal.length)
    add({ id: "content.seasonal", severity: "info", area: "content", title: "Seasonal or sale wording found — is it still current?", detail: "These lines mention a festival, season or sale. Make sure the dates still apply.", why: "Expired offers confuse shoppers.", items: seasonal.slice(0, 20) });
  const announce = home?.sections.find((s) => s.role === "announcement");
  if (home && !announce)
    add({ id: "content.no-announcement", severity: "info", area: "content", title: "No announcement strip at the top of the homepage", detail: "The thin bar above the header is a cheap place for offers, free-shipping notes or festival greetings.", why: "It's the first thing every visitor sees." });
  else if (announce && announce.texts.length === 0 && announce.headings.length === 0)
    add({ id: "content.empty-announcement", severity: "low", area: "content", title: "The announcement strip is empty", detail: "Either add a message or switch it off.", why: "An empty bar looks unfinished." });
  if (home && !home.sections.some((s) => s.role === "newsletter" || s.hasEmailForm))
    add({ id: "content.no-newsletter", severity: "low", area: "content", title: "No email sign-up found on the homepage", detail: "A sign-up form lets you tell past visitors about new drops and festival offers.", why: "Email is the cheapest way to bring people back." });
  const latest = [...snap.content.articles].map((a) => a.lastmod).filter(Boolean).sort().pop();
  if (latest && (today.getTime() - new Date(latest).getTime()) / 86_400_000 > 120)
    add({ id: "content.stale-blog", severity: "low", area: "content", title: "The blog hasn't been updated in over 4 months", detail: `Last post updated ${latest.slice(0, 10)}.`, why: "Fresh posts help search traffic; or hide the blog section if you've stopped." });

  // ── SEO basics (grouped across every page scanned) ──
  const ok = snap.pages.filter((p) => p.status === 200);
  const name = (p: (typeof ok)[number]) => pageName(p, snap.identity.name);
  const item = (p: (typeof ok)[number], extra = "") => ({ label: name(p) + extra, url: p.url });
  const homeOk = ok.find((p) => p.kind === "home");
  if (homeOk && !homeOk.metaDescription)
    add({ id: "seo.no-meta.home", severity: "high", area: "seo", title: "The homepage has no search description", detail: "This is the grey text under your link in Google results.", why: "Without it Google picks random text from the page.", items: [item(homeOk)] });
  else if (homeOk && (homeOk.metaDescription.length < 70 || homeOk.metaDescription.length > 170))
    add({ id: "seo.meta-length.home", severity: "low", area: "seo", title: `The homepage search description is ${homeOk.metaDescription.length < 70 ? "short" : "long"} (${homeOk.metaDescription.length} characters)`, detail: "Aim for roughly 120–160 characters.", why: "Too short wastes space; too long gets cut off.", items: [{ label: short(homeOk.metaDescription, 160) }] });
  const noMeta = ok.filter((p) => p.kind !== "home" && !p.metaDescription);
  if (noMeta.length)
    add({ id: "seo.no-meta", severity: "medium", area: "seo", title: `${noMeta.length} page${noMeta.length > 1 ? "s have" : " has"} no search description`, detail: "The grey text under your link in Google results is missing, so Google makes one up.", why: "A written description gets more clicks from search.", items: noMeta.map((p) => item(p)) });
  const dupMeta = Object.values(ok.filter((p) => p.metaDescription).reduce<Record<string, typeof ok>>((a, p) => ((a[p.metaDescription] ??= []).push(p), a), {})).filter((g) => g.length > 2);
  if (dupMeta.length)
    add({ id: "seo.duplicate-meta", severity: "low", area: "seo", title: `${dupMeta.reduce((a, g) => a + g.length, 0)} pages share the same search description`, detail: "Each page should describe itself.", why: "Identical descriptions make pages look interchangeable to Google.", items: dupMeta.flatMap((g) => g.map((p) => item(p))) });
  const noH1 = ok.filter((p) => p.h1.length === 0);
  if (noH1.length)
    add({ id: "seo.no-h1", severity: "low", area: "seo", title: `${noH1.length} page${noH1.length > 1 ? "s have" : " has"} no main heading (H1)`, detail: "Each page should have one main heading that says what it is about.", why: "Search engines and screen readers use it.", items: noH1.map((p) => item(p)) });
  const manyH1 = ok.filter((p) => p.h1.length > 1);
  if (manyH1.length)
    add({ id: "seo.many-h1", severity: "low", area: "seo", title: `${manyH1.length} page${manyH1.length > 1 ? "s have" : " has"} more than one main heading (H1)`, detail: "Usually there should be exactly one.", why: "Several H1s blur what the page is about.", items: manyH1.map((p) => item(p, ` (${p.h1.length})`)) });
  const errorPages = snap.pages.filter((p) => p.status >= 400);
  if (errorPages.length)
    add({ id: "links.error-pages", severity: "high", area: "links", title: `${errorPages.length} page${errorPages.length > 1 ? "s" : ""} answered with an error`, detail: "These pages are listed in your store but didn't open.", why: "Shoppers and Google hit a dead end.", items: errorPages.map((p) => ({ label: `${p.url} (error ${p.status})`, url: p.url })) });
  if (!snap.identity.ogImage)
    add({ id: "seo.no-share-image", severity: "medium", area: "seo", title: "No sharing image set", detail: "When someone shares your store on WhatsApp or Instagram, no picture appears.", why: "Link previews with images get far more clicks." });

  // ── Links ──
  const broken = links.filter((l) => l.status === 404 || l.status >= 500);
  if (broken.length)
    add({ id: "links.broken", severity: "high", area: "links", title: `${broken.length} link${broken.length > 1 ? "s lead" : " leads"} to a missing page`, detail: "These links on your store open an error page.", why: "Broken links lose sales and hurt search ranking.", items: broken.map((l) => ({ label: `${l.url} (error ${l.status}, linked from ${l.foundOn.slice(0, 3).join(", ")})`, url: base + l.url })) });
  const genericSocial = snap.identity.socialLinks.filter((s) => {
    try {
      const u = new URL(s);
      return u.pathname === "/" || u.pathname === "";
    } catch {
      return false;
    }
  });
  if (genericSocial.length)
    add({ id: "links.generic-social", severity: "medium", area: "links", title: `${genericSocial.length} social icon${genericSocial.length > 1 ? "s go" : " goes"} to the social site's homepage, not your profile`, detail: "Point them at your own page, or remove icons for networks you don't use.", why: "Shoppers clicking them land somewhere useless.", items: genericSocial.map((s) => ({ label: s, url: s })) });

  // ── Visual & speed (only when pictures were taken) ──
  const measured = snap.pages.filter((p) => p.metrics);
  const brokenImg = measured.filter((p) => p.metrics!.brokenImages.length);
  if (brokenImg.length)
    add({ id: "design.broken-images", severity: "high", area: "design", title: `Images failed to load on ${brokenImg.length} page${brokenImg.length > 1 ? "s" : ""}`, detail: "Visitors see an empty box instead of the picture.", why: "Broken images look careless.", items: brokenImg.flatMap((p) => p.metrics!.brokenImages.map((u) => ({ label: `${pageName(p, snap.identity.name)}: ${short(u.split("/").pop() ?? u, 60)}`, url: u }))) });
  const overflow = measured.filter((p) => p.metrics!.mobileOverflowPx > 4);
  if (overflow.length)
    add({ id: "design.mobile-overflow", severity: "high", area: "design", title: `${overflow.length} page${overflow.length > 1 ? "s scroll" : " scrolls"} sideways on phones`, detail: "Something on the page is wider than the phone screen.", why: "Most shoppers are on phones; sideways wobble feels broken.", items: overflow.map((p) => ({ label: `${pageName(p, snap.identity.name)} (${p.metrics!.mobileOverflowPx}px too wide)`, url: p.url })) });
  const heavy = measured.filter((p) => p.metrics!.transferBytes > 6_000_000);
  if (heavy.length)
    add({ id: "speed.heavy", severity: heavy.some((p) => p.metrics!.transferBytes > 12_000_000) ? "high" : "medium", area: "speed", title: `${heavy.length} page${heavy.length > 1 ? "s are" : " is"} heavy to download`, detail: "Large images or videos make these slow on mobile data.", why: "Every extra second of loading loses visitors.", items: heavy.map((p) => ({ label: `${pageName(p, snap.identity.name)} (${(p.metrics!.transferBytes / 1e6).toFixed(1)} MB)`, url: p.url })) });
  const slow = measured.filter((p) => p.metrics!.loadMs > 6000);
  if (slow.length)
    add({ id: "speed.slow", severity: "medium", area: "speed", title: `${slow.length} page${slow.length > 1 ? "s" : ""} took over 6 seconds to load fully`, detail: "Measured from the scanning computer; shoppers on mobile data may wait longer.", why: "Slow pages lose visitors.", items: slow.map((p) => ({ label: `${pageName(p, snap.identity.name)} (${(p.metrics!.loadMs / 1000).toFixed(1)}s)`, url: p.url })) });

  // ── Setup notes ──
  if (snap.identity.theme.custom)
    add({ id: "setup.custom-theme", severity: "info", area: "setup", title: `Your theme is custom-made (“${snap.identity.theme.schemaName || snap.identity.theme.name}” v${snap.identity.theme.schemaVersion || "?"})`, detail: "It isn't from the Shopify Theme Store, so the maintainer learns its layout from this scan instead of a known template.", why: "Good to know before changing anything." });
  const themeImgs = home ? [...new Set(home.sections.filter((s) => !s.hidden).flatMap((s) => s.images.filter((i) => i.source === "theme-file").map((i) => i.src)))] : [];
  if (themeImgs.length)
    add({ id: "setup.theme-file-images", severity: "info", area: "setup", title: `${themeImgs.length} homepage image${themeImgs.length > 1 ? "s are" : " is"} stored inside the theme files`, detail: "These pictures are part of the theme itself, not picked in the theme editor. Changing them means replacing the theme file (the maintainer can do this safely later).", why: "Explains why you may not find them in Customize.", items: themeImgs.map((u) => ({ label: u.split("/").pop()!, url: u })) });
  if (snap.identity.passwordProtected)
    add({ id: "setup.password", severity: "high", area: "setup", title: "The store is password-protected", detail: "Visitors can't see it until the password page is turned off.", why: "Nobody can buy while it's locked." });

  const order = { high: 0, medium: 1, low: 2, info: 3 };
  return f.sort((a, b) => order[a.severity] - order[b.severity]);
}
