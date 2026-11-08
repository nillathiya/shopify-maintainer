# shopify-maintainer

An open-source, self-hosted helper that **looks after an existing Shopify store** for its owner, without needing a developer.

It does not build themes from scratch. It learns the store you already have, keeps a complete picture of it on your own computer, and (in later phases) suggests and makes changes such as banners, sliders, festival campaigns and product updates, always with your approval first.

> **Status: phase 1, the store scanner.** It reads your public store (every page, every word) and takes pictures of every page on computer and phone. It saves all of this as a **store context** folder that people and AI models can use later without scanning again. Phase 1 never changes anything on your store. See [the roadmap](docs/ROADMAP.md).

One copy of this app looks after **one store**. Everything stays on your computer.

---

## What the scan gives you

- **Homepage map**: every section from top to bottom, in plain words ("Main banner slider · 5 slides", "Collection tiles", "Newsletter sign-up"), with a picture of each on computer and phone, what it says, its buttons, and where its pictures come from.
- **Every page, every word**: all products, collections, pages, blogs and blog posts, section by section, in reading order, next to a full-page picture.
- **Your brand look**: the colours and fonts your store actually uses, measured in a real browser.
- **Products and collections**: prices, options, stock, photos, photo descriptions (alt text), and which collections each product is in.
- **Health check**: problems explained simply, with exactly where they are. For example: products without photos, sold-out items, misleading "was" prices, empty collections, missing search descriptions, broken links, social icons pointing nowhere, old years or expired festival offers still on the site, broken images, pages that scroll sideways on phones, heavy pages.
- **What changed since last time**: new products, price changes, homepage edits, fixed and new issues.
- **Notes & rules**: write your decisions down once (e.g. *"never more than 30% off"*, *"tone: playful"*). They're kept between scans and read by any AI assistant.

### Scan once, use many times

Each scan writes a self-contained **store context** folder at `data/store-context/`:

```
STORE.md               ← start here: the whole store summarised, with links
NOTES.md               ← your notes & rules (kept between scans)
pages/*.md             ← every word of every page, section by section
catalog/products/*.md  ← every product in full
screens/*.jpg          ← pictures of every page and section, computer + phone
manifest.json          ← index of every file
snapshot.json          ← everything in structured form
```

Any AI model, today or later, can read this folder and continue from where the last scan left off. Nothing is rescanned unless you press **Scan again**. The format is described in [docs/CONTEXT-FORMAT.md](docs/CONTEXT-FORMAT.md). The previous 3 scans are kept in `data/history/`.

---

## Getting started (no coding needed)

You need a computer running Windows, macOS or Linux.

1. **Install Node.js** (version 22 or newer, "LTS") from <https://nodejs.org>.
2. **Download this project**: on GitHub press **Code → Download ZIP**, then unzip it.
3. **Open a terminal in the project folder.**
   - Windows: open the folder, click the address bar, type `cmd` and press Enter.
   - macOS: right-click the folder in Finder → *New Terminal at Folder*.
4. **Install** (one time only). Type these and press Enter after each:

   ```bash
   npm install
   ```

   ```bash
   npm run setup:browser
   ```

   The second command downloads the browser used to take pictures of your pages.

5. **Start the app:**

   ```bash
   npm start
   ```

6. Open **<http://localhost:4747>** in your browser, type your store address (e.g. `yourstore.com`) and press **Scan my store**.

A scan of a small store takes about 2–3 minutes. To stop the app, press `Ctrl + C` in the terminal. Your results stay saved.

### Optional settings

Everything can be set from the **Settings** screen. Developers can also use a `.env` file (copy `.env.example`):

| Setting | What it does |
|---|---|
| Store address | Your public store URL. |
| Store password | Only if the storefront is password-protected. |
| How much to scan | **Every page** (default) or **Quick look** (one page of each kind, for very large stores). |
| Most pages per scan | Safety limit (default 300). Products past the limit are still fully described from the catalog. |
| Take pictures / Check links | Turn these steps off for faster scans. |
| Admin access (advanced) | Optional, read-only. Lets the scan read your theme's settings and see exactly which texts and images are editable. Create an app in the Shopify **Dev Dashboard** with `read_themes` and `read_products`, install it on your store, and paste its client ID and secret. |

Behind a company proxy? Start with `NODE_USE_ENV_PROXY=1 npm start` so the scanner uses your `HTTPS_PROXY` setting.

---

## For developers

```bash
npm install
npm run setup:browser   # Chromium for the visual scan (or set CHROMIUM_PATH)
npm test                # unit + end-to-end tests (offline, fake store)
npm run typecheck
npm start               # web UI on http://localhost:4747
npm run scan -- yourstore.com   # scan from the command line
```

**Stack:** Node.js ≥ 22.13 + TypeScript (run with `tsx`, no build step), [Hono](https://hono.dev) for the local server, built-in `node:sqlite` for memory, [`node-html-parser`](https://github.com/taoqf/node-html-parser) for reading pages, [Playwright](https://playwright.dev) (optional) for pictures. The UI is plain HTML/CSS/JS in `public/`, no build step.

**How the scan works**: `src/scanner/pipeline.ts` runs these steps:

| Step | Source | File |
|---|---|---|
| Find the store | Homepage HTML (`Shopify.theme`, `Shopify.shop`, meta tags) | `storefront.ts`, `parse.ts` |
| Products & collections | Public `/products.json`, `/products/<handle>.js` (alt text), `/collections.json`, `/collections/<handle>/products.json` | `storefront.ts` |
| Pages & blog posts | `/sitemap.xml` | `storefront.ts` |
| Every page, word by word | Each page's HTML, split by Shopify section (`#shopify-section-…`), with roles and plain-language labels | `parse.ts`, `sections.ts` |
| Pictures | Headless Chromium: full page + each section, 1440px and 390px wide; colours, fonts, broken images, page weight, sideways scroll | `visual.ts` |
| Links | `HEAD` request for every internal link found | `storefront.ts` |
| Theme settings (optional) | Admin GraphQL, read-only: `templates/*.json`, section groups, `settings_data.json`, section Liquid | `admin-scan.ts`, `theme-scan.ts` |
| Health check | Deterministic rules, plain language, stable IDs | `analyze.ts` |
| Save | SQLite history + the store context folder | `context/pack.ts`, `context/store.ts` |

The scanner is polite: it identifies itself, makes at most 3 requests at a time, and backs off when Shopify asks it to (HTTP 429).

```
src/
  index.ts             start the web server
  cli.ts               command-line scan
  config.ts            .env loading
  memory/              SQLite memory + settings
  scanner/             the scan pipeline (see table above)
  context/             the store context folder (writer + rotation)
  shopify/             read-only Admin API client (optional admin scan)
  server/app.ts        JSON API + static UI
public/                web UI (no build step)
test/                  tests with a synthetic store fixture
docs/                  context format, roadmap
```

Contributions are welcome. Please keep phase 1 strictly read-only and keep UI wording plain enough for a non-technical store owner.

## License

MIT
