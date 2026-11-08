// "What changed since the last scan?" in plain language.
import type { StoreSnapshot } from "./types.ts";

export interface Change {
  area: "theme" | "products" | "collections" | "homepage" | "health";
  text: string;
}

export function diffSnapshots(prev: StoreSnapshot, next: StoreSnapshot): Change[] {
  const out: Change[] = [];
  const pt = prev.identity.theme, nt = next.identity.theme;
  if (pt.id !== nt.id) out.push({ area: "theme", text: `A different theme is now live: “${nt.name}” (was “${pt.name}”).` });
  else if (pt.schemaVersion !== nt.schemaVersion) out.push({ area: "theme", text: `Theme updated from v${pt.schemaVersion} to v${nt.schemaVersion}.` });

  const pp = new Map(prev.products.map((p) => [p.handle, p]));
  const np = new Map(next.products.map((p) => [p.handle, p]));
  for (const [h, p] of np) if (!pp.has(h)) out.push({ area: "products", text: `New product: ${p.title}` });
  for (const [h, p] of pp) if (!np.has(h)) out.push({ area: "products", text: `Product removed or hidden: ${p.title}` });
  for (const [h, n] of np) {
    const o = pp.get(h);
    if (!o) continue;
    if (o.priceMin !== n.priceMin || o.priceMax !== n.priceMax) out.push({ area: "products", text: `Price changed for ${n.title}: ${range(o.priceMin, o.priceMax)} → ${range(n.priceMin, n.priceMax)}` });
    if (o.available && !n.available) out.push({ area: "products", text: `${n.title} is now sold out` });
    if (!o.available && n.available) out.push({ area: "products", text: `${n.title} is back in stock` });
    if (o.images.length !== n.images.length) out.push({ area: "products", text: `${n.title} now has ${n.images.length} photo(s) (was ${o.images.length})` });
  }

  const pc = new Set(prev.collections.map((c) => c.handle));
  const nc = new Set(next.collections.map((c) => c.handle));
  for (const c of next.collections) if (!pc.has(c.handle)) out.push({ area: "collections", text: `New collection: ${c.title}` });
  for (const c of prev.collections) if (!nc.has(c.handle)) out.push({ area: "collections", text: `Collection removed or hidden: ${c.title}` });

  const ph = prev.pages.find((p) => p.kind === "home");
  const nh = next.pages.find((p) => p.kind === "home");
  if (ph && nh) {
    const ps = new Map(ph.sections.map((s) => [s.key, s]));
    const ns = new Map(nh.sections.map((s) => [s.key, s]));
    for (const s of nh.sections) if (!ps.has(s.key) && !s.hidden) out.push({ area: "homepage", text: `New homepage section: ${s.label}` });
    for (const s of ph.sections) if (!ns.has(s.key) && !s.hidden) out.push({ area: "homepage", text: `Homepage section removed: ${s.label}` });
    const order = (secs: typeof nh.sections) => secs.filter((s) => !s.hidden && ps.has(s.key) && ns.has(s.key)).map((s) => s.key).join(",");
    if (order(ph.sections) !== order(nh.sections)) out.push({ area: "homepage", text: "Homepage sections were re-ordered." });
    for (const [k, n] of ns) {
      const o = ps.get(k);
      if (!o || n.hidden) continue;
      const added = n.headings.filter((h) => !o.headings.includes(h));
      if (added.length) out.push({ area: "homepage", text: `${n.label.split(" — ")[0]}: new heading “${added[0]}”${added.length > 1 ? ` (+${added.length - 1} more)` : ""}` });
      const oi = new Set(o.images.map((i) => i.src));
      const newImgs = n.images.filter((i) => !oi.has(i.src)).length;
      if (newImgs) out.push({ area: "homepage", text: `${n.label.split(" — ")[0]}: ${newImgs} new image(s)` });
      if (o.slideCount !== n.slideCount && n.role === "hero-slider") out.push({ area: "homepage", text: `Main banner now has ${n.slideCount} slides (was ${o.slideCount})` });
    }
  }

  const pf = new Set(prev.findings.map((f) => f.id));
  const nf = new Set(next.findings.map((f) => f.id));
  for (const f of next.findings) if (!pf.has(f.id) && f.severity !== "info") out.push({ area: "health", text: `New issue: ${f.title}` });
  for (const f of prev.findings) if (!nf.has(f.id) && f.severity !== "info") out.push({ area: "health", text: `Fixed: ${f.title}` });
  return out;
}

const range = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);
