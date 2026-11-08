# Store context format (v1)

Every successful scan writes one self-contained folder, `data/store-context/`, that describes the store in words and pictures. It is meant to be read by **people and by any AI model**, so work can continue from the last scan **without scanning again**. Only scan again when the owner asks, or presses **Scan again** in the app.

If you are an AI assistant given this folder: read `STORE.md` first, then `NOTES.md`. Open other files only as needed. Treat the content as the store's state at `manifest.json → scannedAt`.

## Files

| Path | What it is |
|---|---|
| `STORE.md` | Overview and entry point: store facts, menu, brand colours/fonts, the homepage section by section (with section keys and picture links), page layouts per page kind, product and collection tables, list of every page scanned, health check, changes since the previous scan. |
| `NOTES.md` | Owner and assistant notes: decisions, brand rules, things to avoid. **Carried over between scans.** Append to it instead of guessing. |
| `pages/<slug>.md` | One file per page scanned. Header with address, browser title, search description, main heading(s), picture links and measured speed, then every visible section in order: plain-language label, Shopify section key, the JSON file it is stored in, position on the page, picture links, image sources, and **every word** as Markdown. |
| `catalog/products/<handle>.md` | Every product in full: price, type, vendor, tags, collections, options, a variants table (SKU, price, compare-at price, stock), the full description and every photo with its alt text. |
| `catalog/products.json`, `catalog/collections.json` | The same catalog as structured data. |
| `screens/*.jpg` | Pictures. `<slug>--desktop.jpg` / `<slug>--mobile.jpg` are full pages (1440px / 390px wide, max 16,000px tall). `<slug>--<viewport>-<section-key>.jpg` is one section. Header/footer sections are pictured on the homepage only. |
| `manifest.json` | Index: `generator`, `schemaVersion`, `scanId`, `scannedAt`, `store {name, url, shopDomain, theme}`, `entry` (`STORE.md`), and `files[]` with `path`, `type` (`overview`, `notes`, `page`, `product`, `data`, `screenshot`), `title`, `url` and `bytes`. |
| `snapshot.json` | Everything above as one structured document. Its shape is the `StoreSnapshot` type in [`src/scanner/types.ts`](../src/scanner/types.ts). |

### Page slugs

`home`, `collections`, `collection--<handle>`, `product--<handle>`, `page--<handle>`, `blog--<blog>`, `article--<blog>--<handle>`.

### How wording is written in page files

Inside each section, lines appear in the order shoppers read them:

```
### Heading text                 ← headings (## = H1, ### = H2, …)
Plain paragraph or list text
[Button: Shop now](/collections/bags)
[Link text](/products/tan-bag)
![Image description](https://…/image.jpg)   ← "no description" = missing alt text
[Video: label]
[Email sign-up box]
```

Hidden slides of a slider are included. Repeated copies (for example a scrolling text strip duplicated for animation) are removed.

### Section keys and files

Each section shows its Shopify **section key** (for example `hero`) and where it is stored:

- `templates/index.json` (homepage), `templates/product.json`, `templates/collection.json`, … for page content
- `sections/header-group.json` / `sections/footer-group.json` for the announcement bar, header, newsletter and footer

These are the exact names Shopify uses in theme files, so a later change can target a section precisely. When admin access is connected, sections also list their **editable settings** (setting name, block id, type, current value).

### Image sources

`theme-file` (built into the theme's `assets/` folder; not swappable from the theme editor's image pickers), `uploaded-file` (Shopify Files / theme settings), `product`, `collection`, `article`, `external`.

## History

The previous 3 context folders are kept in `data/history/<scanId>/`. All scans, including older ones whose pictures have been pruned, remain in `data/memory.sqlite` (`scans` table, `snapshot` column).

## Versioning

`manifest.json → schemaVersion` changes when this format changes in a way readers must handle.
