// Store Maintainer — browser app. Plain JavaScript, no build step.
// Reads what the last scan saved; only scans when the operator presses "Scan".

const $app = document.getElementById("app");

// ── helpers ──────────────────────────────────────────────────────────────
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = {
  async req(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  },
  get: (u) => api.req("GET", u),
  post: (u, b) => api.req("POST", u, b ?? {}),
  put: (u, b) => api.req("PUT", u, b),
};
const plural = (n, one, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;
function ago(iso) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return plural(Math.round(s / 60), "minute") + " ago";
  if (s < 86400) return plural(Math.round(s / 3600), "hour") + " ago";
  return plural(Math.round(s / 86400), "day") + " ago";
}
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const shot = (scanId, file) => (file ? `/screens/${encodeURIComponent(scanId)}/${encodeURIComponent(file)}` : "");
const cdn = (src, w = 480) => (src && /cdn\.shopify\.com|\/cdn\/shop\//.test(src) ? `${src}${src.includes("?") ? "&" : "?"}width=${w}` : src);
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}
const pref = {
  get: (k, d) => { try { return localStorage.getItem("sm." + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem("sm." + k, v); } catch { /* private mode */ } },
};

const ICONS = {
  overview: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  homepage: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M8 13h8M8 17h5"/>',
  pages: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  products: '<path d="M5 8h14l-1.5 12h-11z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  health: '<path d="M12 21s-7-4.5-7-11a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 6.5-7 11-7 11z"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  notes: '<path d="M5 4h14v16H5z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const NAV = [
  ["overview", "Overview"],
  ["homepage", "Homepage map"],
  ["pages", "All pages"],
  ["products", "Products"],
  ["health", "Health check"],
  ["history", "Scan history"],
  ["notes", "Notes & rules"],
  ["settings", "Settings"],
];

const SEVERITY = {
  high: { title: "Fix soon", hint: "These hurt sales or trust right now." },
  medium: { title: "Worth fixing", hint: "Clear improvements when you have time." },
  low: { title: "Nice to have", hint: "Polish that adds up." },
  info: { title: "Good to know", hint: "Not problems — just useful facts about your store." },
};

const SOURCE_WORDS = {
  "theme-file": "built into the theme",
  "uploaded-file": "from your Files",
  product: "product photos",
  collection: "collection covers",
  article: "blog images",
  external: "from other websites",
  other: "other",
};

// ── state ────────────────────────────────────────────────────────────────
const state = { status: null, cache: {}, polling: null };
async function loadStatus() {
  state.status = await api.get("/api/status");
  return state.status;
}
async function cached(key, url) {
  if (!(key in state.cache)) state.cache[key] = await api.get(url);
  return state.cache[key];
}
const clearCache = () => (state.cache = {});

// ── scanning ─────────────────────────────────────────────────────────────
async function startScan(storeUrl) {
  try {
    await api.post("/api/scan", storeUrl ? { storeUrl } : {});
    await loadStatus();
    render();
  } catch (e) {
    toast(e.message);
  }
}

function pollScan() {
  if (state.polling) return;
  state.polling = setInterval(async () => {
    const job = await api.get("/api/scan/current").catch(() => null);
    if (!job) return;
    state.status.job = job;
    if (job.status !== "running") {
      clearInterval(state.polling);
      state.polling = null;
      clearCache();
      await loadStatus();
      if (job.status === "done") {
        location.hash = "#/overview";
        toast("Scan complete — everything is saved");
      }
      render();
    } else renderProgress(job);
  }, 1000);
}

// ── layout ───────────────────────────────────────────────────────────────
function shell(active, inner) {
  const st = state.status;
  const latest = st.latest;
  const urgent = latest?.issuesHigh ?? 0;
  return `
  <div class="shell">
    <aside class="side">
      <div class="brand"><span class="brand-mark">${icon("products")}</span> Store Maintainer</div>
      <nav class="nav" aria-label="Main">
        ${NAV.map(([id, label]) => `<a href="#/${id}" ${active === id ? 'aria-current="page"' : ""}>${icon(id)}<span>${label}</span>${id === "health" && urgent ? `<span class="count">${urgent}</span>` : ""}</a>`).join("")}
      </nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="store">
          <b>${esc(latest?.storeName || st.settings.storeUrl.replace(/^https?:\/\//, ""))}</b>
          <span class="muted small">${latest ? `Last scanned ${ago(latest.scannedAt)}` : "Not scanned yet"}</span>
        </div>
        <button class="btn primary" data-action="scan">Scan again</button>
      </header>
      <main class="content" id="content">${inner}</main>
    </div>
  </div>`;
}

function renderWelcome(error) {
  const s = state.status.settings;
  $app.innerHTML = `
  <div class="center-wrap">
    <div class="welcome card">
      <div class="brand" style="padding:0 0 12px"><span class="brand-mark">${icon("products")}</span> Store Maintainer</div>
      <h1>Let's get to know your store</h1>
      <p class="lead">Type your store's web address. We'll read every page, every word and take pictures on computer and phone, so you can see everything in one place.</p>
      <form id="welcome-form" class="stack">
        <label for="store-url">Your store address</label>
        <div class="url-row">
          <input id="store-url" type="text" inputmode="url" autocomplete="url" placeholder="yourstore.com" value="${esc(s.storeUrl.replace(/^https?:\/\//, ""))}" required />
          <button class="btn primary big" type="submit">Scan my store</button>
        </div>
        ${error ? `<div class="callout warn" role="alert">${esc(error)}</div>` : ""}
      </form>
      <ul class="promise-list">
        <li>${icon("check")}<span><b>Nothing is changed.</b> Scanning only reads your public store, like a visitor would.</span></li>
        <li>${icon("check")}<span><b>No passwords needed</b> to start. Everything stays on this computer.</span></li>
        <li>${icon("check")}<span><b>Scan once, use many times.</b> Results are saved, so you only scan again when something changes.</span></li>
      </ul>
    </div>
  </div>`;
  document.getElementById("welcome-form").addEventListener("submit", (e) => {
    e.preventDefault();
    startScan(document.getElementById("store-url").value);
  });
}

function progressHtml(job) {
  const done = job.steps.filter((s) => ["done", "skipped", "failed"].includes(s.status)).length;
  const pct = Math.round((done / job.steps.length) * 100);
  const mark = { done: "✓", failed: "!", skipped: "–", waiting: "", running: "" };
  return `
    <h1>Scanning ${esc(job.storeUrl.replace(/^https?:\/\//, ""))}</h1>
    <p class="muted">This usually takes a few minutes. You can leave this page open; nothing on your store is changed.</p>
    <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <ol class="steps">
      ${job.steps.map((s) => `<li class="${s.status}"><span class="icon">${mark[s.status]}</span><div><div class="title">${esc(s.title)}</div>${s.note ? `<div class="note">${esc(s.note)}</div>` : ""}</div></li>`).join("")}
    </ol>`;
}

function renderProgress(job) {
  const box = document.getElementById("progress-box");
  if (box) box.innerHTML = progressHtml(job);
  else $app.innerHTML = `<div class="center-wrap"><div class="welcome card" id="progress-box">${progressHtml(job)}</div></div>`;
}

// ── views ────────────────────────────────────────────────────────────────
const views = {};

views.overview = async () => {
  const o = await cached("overview", "/api/overview");
  if (!o) return `<div class="empty">No scan yet.</div>`;
  const st = o.stats;
  const id = o.identity;
  const [high, medium, low] = o.findingCounts;
  const theme = id.theme;
  return `
  <div class="page-head">
    <div><h1>${esc(id.name || id.url)}</h1><p class="muted"><a href="${esc(id.url)}" target="_blank" rel="noopener">${esc(id.url.replace(/^https?:\/\//, ""))}</a> · scanned ${esc(when(o.scannedAt))}</p></div>
  </div>
  <div class="tiles">
    <a class="tile" href="#/products"><div class="num">${st.products}</div><div class="lbl">Products · ${plural(st.variants, "option")}</div></a>
    <a class="tile" href="#/products"><div class="num">${st.collections}</div><div class="lbl">Collections</div></a>
    <a class="tile" href="#/pages"><div class="num">${st.pagesScanned}</div><div class="lbl">Pages read</div></a>
    <a class="tile" href="#/homepage"><div class="num">${st.homeSections}</div><div class="lbl">Homepage sections</div></a>
    <a class="tile ${high ? "alert" : ""}" href="#/health"><div class="num">${high + medium}</div><div class="lbl">Things worth fixing${high ? ` · ${high} soon` : ""}</div></a>
  </div>

  <div class="grid two" style="margin-top:16px">
    <section class="card">
      <h2>What changed since last time</h2>
      ${o.changes.length ? `<ul class="list">${o.changes.slice(0, 12).map((c) => `<li>${esc(c.text)}</li>`).join("")}</ul>${o.changes.length > 12 ? `<p class="muted small">…and ${o.changes.length - 12} more on the <a href="#/history">history</a> page.</p>` : ""}` : `<p class="muted">${st && state.status.latest ? "This is the first scan, or nothing changed since the previous one." : ""}</p>`}
    </section>
    <section class="card">
      <h2>Your store at a glance</h2>
      <dl class="kv">
        <dt>Theme</dt><dd>${esc(theme.name)}${theme.schemaName ? ` <span class="muted">(${esc(theme.schemaName)} v${esc(theme.schemaVersion)})</span>` : ""}${theme.custom ? ' <span class="badge info">custom-made</span>' : ""}</dd>
        <dt>Currency</dt><dd>${esc(id.currency)}</dd>
        <dt>Country</dt><dd>${esc(id.country)}</dd>
        <dt>Shopify name</dt><dd>${esc(id.shopDomain)}</dd>
        <dt>Social</dt><dd>${id.socialLinks.map((s) => `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s.replace(/^https?:\/\/(www\.)?/, ""))}</a>`).join(", ") || "—"}</dd>
        <dt>Contact</dt><dd>${[...id.contact.email, ...id.contact.phone, ...id.contact.whatsapp].map(esc).join(", ") || "—"}</dd>
      </dl>
    </section>
  </div>

  ${o.design ? `
  <section class="card" style="margin-top:16px">
    <h2>Your brand look</h2>
    <p class="muted small">Measured from your homepage in a real browser.</p>
    <div class="swatches">${o.design.colors.map((c) => `<span class="swatch"><i style="background:${esc(c.value)}"></i><span>${esc(c.value)}<br><span class="muted">${esc(c.role)}</span></span></span>`).join("")}</div>
    <p style="margin-top:14px">Fonts: ${o.design.fonts.map((f) => `<b>${esc(f.family)}</b> <span class="muted">(${esc(f.role)})</span>`).join(", ")}</p>
  </section>` : ""}

  ${o.admin ? adminCard(o) : ""}

  <section class="card" style="margin-top:16px">
    <h2>Saved for later — no need to scan again</h2>
    <p>Everything this scan learned is saved on this computer in a <b>store context</b> folder: a written description of every page, every product and a picture of each. Any AI assistant can read it later and carry on from here.</p>
    <p class="muted small">Folder: <code>${esc(state.status.contextFolder)}</code></p>
    <p><a class="btn" href="/context/STORE.md" target="_blank" rel="noopener">Open the store overview (STORE.md)</a></p>
  </section>

  ${o.warnings.length ? `<section class="callout warn" style="margin-top:16px"><b>Notes from the scan</b><ul>${o.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></section>` : ""}
  `;
};

function adminCard(o) {
  const a = o.admin;
  const homeEditable = (o.home?.sections || []).filter((s) => s.editable?.length);
  const imgs = Object.entries(a.hardcodedImages || {});
  return `
  <section class="card" style="margin-top:16px">
    <h2>Theme settings <span class="badge ok">admin access connected</span></h2>
    <p class="muted small">Read from your live theme “${esc(a.themeName)}” (read-only).</p>
    <div class="tiles" style="margin:12px 0">
      <div class="tile"><div class="num">${a.editableSlotCount}</div><div class="lbl">Texts, images & links you can change in the theme editor</div></div>
      <div class="tile"><div class="num">${homeEditable.length}</div><div class="lbl">Homepage sections with changeable settings</div></div>
      <div class="tile"><div class="num">${a.templates.length}</div><div class="lbl">Page templates</div></div>
      <div class="tile"><div class="num">${imgs.length}</div><div class="lbl">Homepage pictures built into theme files</div></div>
    </div>
    ${a.editableSlotCount === 0 ? `<p class="callout warn">No changeable texts or images were found in your theme's settings. Custom-made themes sometimes keep their content inside the theme code instead. That's useful to know before planning changes.</p>` : ""}
    ${imgs.length ? `<details><summary>Which theme files use the built-in pictures</summary>
      <div class="table-wrap"><table><thead><tr><th>Picture</th><th>Used in</th></tr></thead><tbody>
      ${imgs.map(([img, files]) => `<tr><td><code>${esc(img)}</code></td><td>${files.length ? files.map((f) => `<code>${esc(f)}</code>`).join(" ") : '<span class="muted">not found in section code (may be set in theme settings)</span>'}</td></tr>`).join("")}
      </tbody></table></div></details>` : ""}
  </section>`;
}

function editableList(s) {
  if (!s.editable?.length) return "";
  return `<details><summary>What can be changed in the theme editor (${s.editable.length})</summary>
    <div class="table-wrap"><table><thead><tr><th>Setting</th><th>Type</th><th>Current value</th></tr></thead><tbody>
    ${s.editable.map((e) => `<tr><td><code>${esc(e.setting)}</code>${e.blockId ? `<br><span class="muted small">block ${esc(e.blockId)}</span>` : ""}</td><td>${esc(e.kind)}</td><td style="overflow-wrap:anywhere">${esc(String(e.value).slice(0, 200)) || '<span class="muted">(empty)</span>'}</td></tr>`).join("")}
    </tbody></table></div></details>`;
}

function sourceSummary(images) {
  const by = {};
  for (const i of images) by[i.source] = (by[i.source] || 0) + 1;
  return Object.entries(by).map(([k, n]) => `${n} ${SOURCE_WORDS[k] || k}`).join(", ");
}

views.homepage = async () => {
  const o = await cached("overview", "/api/overview");
  if (!o?.home) return `<div class="empty">No homepage scanned yet.</div>`;
  const mode = pref.get("viewport", "desktop");
  const secs = o.home.sections;
  return `
  <div class="page-head">
    <div><h1>Homepage map</h1><p class="muted">Your homepage from top to bottom, ${plural(secs.length, "section")}. Each part shows what it says and where its pictures come from.</p></div>
    <div class="view-toggle" role="group" aria-label="Picture size">
      <button data-viewport="desktop" aria-pressed="${mode === "desktop"}">Computer</button>
      <button data-viewport="mobile" aria-pressed="${mode === "mobile"}">Phone</button>
    </div>
  </div>
  <div class="stack">
  ${secs.map((s, i) => {
    const file = s.screens?.[mode];
    return `
    <article class="card section-card ${mode === "mobile" ? "phone" : ""}">
      <div class="shot ${file ? "" : "none"}">${file ? `<img loading="lazy" src="${shot(o.scanId, file)}" alt="Picture of the ${esc(s.label)} section">` : "No picture"}</div>
      <div>
        <div class="num">PART ${i + 1}${s.screens?.aboveFold ? " · seen without scrolling" : ""}</div>
        <h2>${esc(s.label)}</h2>
        ${s.headings.length ? `<p><b>Headings:</b> ${s.headings.slice(0, 6).map(esc).join(" · ")}</p>` : s.texts.length ? `<p><b>Says:</b> ${s.texts.slice(0, 4).map(esc).join(" · ")}</p>` : ""}
        ${s.buttons.length ? `<p><b>Buttons:</b> ${s.buttons.slice(0, 6).map((b) => `<span class="badge">${esc(b.text)}</span>`).join(" ")}</p>` : ""}
        ${s.images.length ? `<p><b>Pictures:</b> ${esc(sourceSummary(s.images))}</p>` : ""}
        ${editableList(s)}
        <details><summary>Show every word (${plural(s.words, "word")})</summary><div class="wording">${esc(s.content || "(no text)")}</div></details>
        <p class="muted small" style="margin-top:6px">Shopify name: <code>${esc(s.key)}</code>${s.groupFile ? ` in <code>${esc(s.groupFile)}</code>` : ""}</p>
      </div>
    </article>`;
  }).join("")}
  </div>`;
};

views.pages = async () => {
  const pages = await cached("pages", "/api/pages");
  if (!pages.length) return `<div class="empty">No pages scanned yet.</div>`;
  const groups = {};
  for (const p of pages) (groups[p.kind] ||= []).push(p);
  const order = [["home", "Homepage"], ["collections", "Collection list"], ["collection", "Collections"], ["product", "Products"], ["page", "Pages"], ["blog", "Blogs"], ["article", "Blog posts"], ["other", "Other"]];
  return `
  <div class="page-head">
    <div><h1>All pages</h1><p class="muted">${plural(pages.length, "page")} read, ${plural(pages.reduce((a, p) => a + p.words, 0), "word")} in total. Open any page to see its picture and every word on it.</p></div>
    <input type="search" id="page-filter" placeholder="Find a page…" style="max-width:280px" aria-label="Find a page" />
  </div>
  ${order.filter(([k]) => groups[k]).map(([k, label]) => `
    <section class="card page-group" style="margin-bottom:16px">
      <h2>${label} <span class="muted small">(${groups[k].length})</span></h2>
      <div class="page-list">
        ${groups[k].map((p) => `<a href="#/page/${p.index}" data-name="${esc((p.name + " " + p.url).toLowerCase())}"><span><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.url.replace(/^https?:\/\/[^/]+/, "") || "/")}</span></span><span class="chips">${p.status !== 200 ? `<span class="badge high">error ${p.status}</span>` : ""}${!p.metaDescription ? '<span class="badge medium">no search text</span>' : ""}<span class="badge">${plural(p.sections, "section")}</span></span></a>`).join("")}
      </div>
    </section>`).join("")}`;
};

views.page = async (index) => {
  const p = await api.get(`/api/pages/${index}`);
  const mode = pref.get("viewport", "desktop");
  const file = p.screens?.[mode];
  return `
  <p><a href="#/pages">← All pages</a></p>
  <div class="page-head">
    <div><h1>${esc(p.name)}</h1><p class="muted"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></p></div>
    <div class="view-toggle" role="group" aria-label="Picture size">
      <button data-viewport="desktop" aria-pressed="${mode === "desktop"}">Computer</button>
      <button data-viewport="mobile" aria-pressed="${mode === "mobile"}">Phone</button>
    </div>
  </div>
  <div class="page-viewer">
    <div class="full-shot ${mode === "mobile" ? "phone" : ""}">${file ? `<img src="${shot(p.scanId, file)}" alt="Full picture of ${esc(p.name)}">` : '<div class="empty">No picture for this page.<br>Turn on “Take pictures” in Settings and scan again.</div>'}</div>
    <div class="stack">
      <section class="card">
        <dl class="kv">
          <dt>Browser title</dt><dd>${esc(p.title) || "—"}</dd>
          <dt>Search text</dt><dd>${esc(p.metaDescription) || '<span class="badge medium">missing</span>'}</dd>
          <dt>Main heading</dt><dd>${p.h1.map(esc).join(" / ") || '<span class="badge low">missing</span>'}</dd>
          ${p.metrics ? `<dt>Speed</dt><dd>${(p.metrics.loadMs / 1000).toFixed(1)}s · ${(p.metrics.transferBytes / 1e6).toFixed(1)} MB</dd>` : ""}
        </dl>
      </section>
      ${p.sections.map((s, i) => `
      <section class="card">
        <div class="num muted small"><b>PART ${i + 1}</b>${s.group !== "template" && p.kind !== "home" ? " · same on every page" : ""}</div>
        <h3>${esc(s.label)}</h3>
        ${s.images.length ? `<p class="small muted">Pictures: ${esc(sourceSummary(s.images))}</p>` : ""}
        ${editableList(s)}
        ${s.group !== "template" && p.kind !== "home" ? "" : `<details ${p.sections.length < 6 ? "open" : ""}><summary>Every word</summary><div class="wording">${esc(s.content || "(no text)")}</div></details>`}
      </section>`).join("")}
    </div>
  </div>`;
};

views.products = async () => {
  const c = await cached("catalog", "/api/catalog");
  if (!c) return `<div class="empty">No scan yet.</div>`;
  const money = (n) => `${c.currency} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const price = (p) => (p.priceMin === p.priceMax ? money(p.priceMin) : `${money(p.priceMin)} – ${money(p.priceMax)}`);
  return `
  <div class="page-head"><div><h1>Products</h1><p class="muted">${plural(c.products.length, "product")} and ${plural(c.collections.length, "collection")}, read from your public store.</p></div></div>
  <div class="products">
    ${c.products.map((p) => {
      const flags = [];
      if (!p.available) flags.push('<span class="badge high">sold out</span>');
      if (!p.images.length) flags.push('<span class="badge high">no photos</span>');
      if (p.descriptionText.length < 150) flags.push('<span class="badge medium">short description</span>');
      const noAlt = p.images.filter((i) => !i.alt).length;
      if (noAlt) flags.push(`<span class="badge low">${noAlt} photo${noAlt > 1 ? "s" : ""} without description</span>`);
      return `
      <article class="product">
        <div class="ph">${p.images[0] ? `<img loading="lazy" src="${esc(cdn(p.images[0].src))}" alt="${esc(p.images[0].alt || p.title)}">` : ""}</div>
        <div class="body">
          <b>${esc(p.title)}</b>
          <span class="price">${price(p)}</span>
          <span class="muted small">${plural(p.variants.length, "option")} · ${plural(p.images.length, "photo")}${p.productType ? ` · ${esc(p.productType)}` : ""}</span>
          <span class="chips">${flags.join("") || '<span class="badge ok">looks good</span>'}</span>
          <a class="small" href="${esc(c.storeUrl)}/products/${esc(p.handle)}" target="_blank" rel="noopener">View in store ↗</a>
        </div>
      </article>`;
    }).join("")}
  </div>
  <section class="card" style="margin-top:20px">
    <h2>Collections</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Collection</th><th class="num">Products</th><th>Cover image</th><th>Description</th></tr></thead>
      <tbody>${c.collections.map((col) => `<tr><td><a href="${esc(c.storeUrl)}/collections/${esc(col.handle)}" target="_blank" rel="noopener">${esc(col.title)}</a></td><td class="num">${col.productsCount}</td><td>${col.image ? "Yes" : '<span class="badge low">missing</span>'}</td><td class="muted">${esc(col.descriptionText.slice(0, 120)) || "—"}</td></tr>`).join("")}</tbody>
    </table></div>
  </section>`;
};

views.health = async () => {
  const fs = await cached("findings", "/api/findings");
  if (!fs.length) return `<div class="page-head"><h1>Health check</h1></div><div class="card empty">No issues found. Nice work.</div>`;
  return `
  <div class="page-head"><div><h1>Health check</h1><p class="muted">Plain-language checks of your products, pages, links and pictures. Open any item to see exactly where.</p></div></div>
  ${["high", "medium", "low", "info"].map((sev) => {
    const list = fs.filter((f) => f.severity === sev);
    if (!list.length) return "";
    return `
    <div class="group-title"><h2 style="margin:0">${SEVERITY[sev].title}</h2><span class="badge ${sev}">${list.length}</span><span class="muted small">${SEVERITY[sev].hint}</span></div>
    <div class="stack">
      ${list.map((f) => `
      <details class="card finding ${sev}">
        <summary><span>${esc(f.title)}</span></summary>
        <p style="margin-top:8px">${esc(f.detail)}</p>
        <p class="muted small"><b>Why it matters:</b> ${esc(f.why)}</p>
        ${f.items?.length ? `<ul>${f.items.slice(0, 50).map((it) => `<li>${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.label)}</a>` : esc(it.label)}</li>`).join("")}${f.items.length > 50 ? `<li class="muted">…and ${f.items.length - 50} more</li>` : ""}</ul>` : ""}
      </details>`).join("")}
    </div>`;
  }).join("")}`;
};

views.history = async () => {
  const scans = await api.get("/api/history");
  return `
  <div class="page-head"><div><h1>Scan history</h1><p class="muted">Every scan is remembered. The latest 3 keep their pictures.</p></div></div>
  <div class="stack">
  ${scans.map((s) => `
    <section class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <b>${esc(when(s.started_at))}</b>
        <span class="badge ${s.status === "done" ? "ok" : s.status === "failed" ? "high" : "info"}">${s.status === "done" ? "complete" : esc(s.status)}</span>
      </div>
      ${s.summary ? `<p class="muted small">${plural(s.summary.products, "product")} · ${plural(s.summary.pagesScanned, "page")} · ${s.summary.issuesHigh + s.summary.issuesMedium} things worth fixing · took ${s.summary.durationSec}s</p>` : ""}
      ${s.error ? `<p class="small" style="color:var(--high)">${esc(s.error)}</p>` : ""}
      ${s.summary?.changes?.length ? `<details><summary>${plural(s.summary.changes.length, "change")} since the scan before</summary><ul>${s.summary.changes.map((c) => `<li>${esc(c.text)}</li>`).join("")}</ul></details>` : ""}
    </section>`).join("") || '<div class="empty">No scans yet.</div>'}
  </div>`;
};

views.notes = async () => {
  const n = await api.get("/api/notes");
  return `
  <div class="page-head"><div><h1>Notes & rules</h1><p class="muted">Write down decisions and rules for your store, e.g. “Never offer more than 30% off” or “Our tone is playful, never formal”. These are kept between scans and read by any AI assistant that uses the store context.</p></div></div>
  <form id="notes-form" class="card">
    <label for="notes">Your notes</label>
    <textarea id="notes">${esc(n.text)}</textarea>
    <p style="margin-top:12px"><button class="btn primary" type="submit">Save notes</button></p>
  </form>`;
};

views.settings = async () => {
  const s = await api.get("/api/settings");
  const lock = (k) => (s.lockedByEnv?.[k] ? 'disabled title="Set in the .env file"' : "");
  return `
  <div class="page-head"><div><h1>Settings</h1><p class="muted">Saved on this computer only.</p></div></div>
  <form id="settings-form" class="stack">
    <section class="card">
      <h2>Your store</h2>
      <div class="field"><label for="storeUrl">Store address</label><input id="storeUrl" name="storeUrl" type="text" value="${esc(s.storeUrl)}" ${lock("storeUrl")} /></div>
      <div class="field"><label for="storefrontPassword">Store password <span class="muted">(only if your store is locked)</span></label><input id="storefrontPassword" name="storefrontPassword" type="password" value="${esc(s.storefrontPassword)}" autocomplete="off" /></div>
    </section>
    <section class="card">
      <h2>How much to scan</h2>
      <div class="radio-cards field">
        <label class="radio-card"><input type="radio" name="scanDepth" value="full" ${s.scanDepth === "full" ? "checked" : ""}><span><b>Every page</b><br><span class="muted small">Recommended. Reads and pictures every product, collection, page and blog post.</span></span></label>
        <label class="radio-card"><input type="radio" name="scanDepth" value="quick" ${s.scanDepth === "quick" ? "checked" : ""}><span><b>Quick look</b><br><span class="muted small">One page of each kind. Faster for very big stores.</span></span></label>
      </div>
      <div class="field"><label for="maxPages">Most pages to read in one scan</label><input id="maxPages" name="maxPages" type="number" min="10" max="5000" value="${s.maxPages}" style="max-width:160px" /><div class="hint">A safety limit for very large stores. Products past the limit are still described from your catalog.</div></div>
      <div class="field"><label class="check"><input type="checkbox" name="takePictures" ${s.takePictures ? "checked" : ""}><span><b>Take pictures</b><span class="muted small">Pictures of every page on computer and phone. Needs the browser add-on (see the guide).</span></span></label></div>
      <div class="field"><label class="check"><input type="checkbox" name="checkLinks" ${s.checkLinks ? "checked" : ""}><span><b>Check links</b><span class="muted small">Finds links that lead to missing pages.</span></span></label></div>
    </section>
    <details class="card">
      <summary>Advanced: connect admin access (optional)</summary>
      <p class="muted small" style="margin-top:8px">Lets the scan read your theme settings to see exactly which texts and pictures can be changed. Read-only. Create an app in the Shopify Dev Dashboard with the <code>read_themes</code> and <code>read_products</code> permissions and install it on your store, then paste its details here.</p>
      <div class="field"><label for="shopDomain">Shopify domain</label><input id="shopDomain" name="shopDomain" type="text" placeholder="your-store.myshopify.com" value="${esc(s.shopDomain)}" /><div class="hint">Filled in automatically after the first scan.</div></div>
      <div class="field"><label for="clientId">Client ID</label><input id="clientId" name="clientId" type="text" value="${esc(s.clientId)}" ${lock("clientId")} autocomplete="off" /></div>
      <div class="field"><label for="clientSecret">Client secret</label><input id="clientSecret" name="clientSecret" type="password" value="${esc(s.clientSecret)}" ${lock("clientSecret")} autocomplete="off" /></div>
      <div class="field"><label for="adminToken">Or: admin API token <span class="muted">(older custom apps, starts with shpat_)</span></label><input id="adminToken" name="adminToken" type="password" value="${esc(s.adminToken)}" ${lock("adminToken")} autocomplete="off" /></div>
      <p>${s.adminConnected ? '<span class="badge ok">Admin access set up</span>' : '<span class="badge">Not connected</span>'}</p>
    </details>
    <p><button class="btn primary" type="submit">Save settings</button></p>
  </form>`;
};

// ── router & events ──────────────────────────────────────────────────────
async function render() {
  const st = state.status || (await loadStatus());
  const job = st.job;
  if (job?.status === "running") {
    renderProgress(job);
    pollScan();
    return;
  }
  if (!st.latest) {
    renderWelcome(job?.status === "failed" ? job.error : null);
    return;
  }
  const [, route = "overview", arg] = location.hash.replace(/^#\/?/, "#").split(/[#/]/);
  const name = views[route] ? route : "overview";
  const active = name === "page" ? "pages" : name;
  $app.innerHTML = shell(active, '<p class="muted">Loading…</p>');
  try {
    document.getElementById("content").innerHTML = await views[name](arg);
  } catch (e) {
    document.getElementById("content").innerHTML = `<div class="callout warn">${esc(e.message)}</div>`;
  }
  if (job?.status === "failed" && !state.shownError) {
    state.shownError = true;
    toast("The last scan didn't finish: " + job.error);
  }
  document.title = `${NAV.find(([id]) => id === active)?.[1] ?? "Store"} · Store Maintainer`;
}

document.addEventListener("click", async (e) => {
  const scanBtn = e.target.closest("[data-action=scan]");
  if (scanBtn) {
    scanBtn.disabled = true;
    return startScan();
  }
  const vp = e.target.closest("[data-viewport]");
  if (vp) {
    pref.set("viewport", vp.dataset.viewport);
    render();
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id !== "page-filter") return;
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll(".page-list a").forEach((a) => (a.hidden = q && !a.dataset.name.includes(q)));
  document.querySelectorAll(".page-group").forEach((g) => (g.hidden = ![...g.querySelectorAll(".page-list a")].some((a) => !a.hidden)));
});

document.addEventListener("submit", async (e) => {
  if (e.target.id === "notes-form") {
    e.preventDefault();
    await api.put("/api/notes", { text: document.getElementById("notes").value });
    toast("Notes saved");
  }
  if (e.target.id === "settings-form") {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = Object.fromEntries([...f.entries()].filter(([k]) => !["takePictures", "checkLinks"].includes(k)));
    body.takePictures = f.has("takePictures");
    body.checkLinks = f.has("checkLinks");
    try {
      await api.put("/api/settings", body);
      await loadStatus();
      toast("Settings saved");
    } catch (err) {
      toast(err.message);
    }
  }
});

window.addEventListener("hashchange", render);
render();
