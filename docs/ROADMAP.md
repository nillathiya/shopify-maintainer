# Roadmap

The goal: a free, open, self-hosted maintainer that keeps an **existing** Shopify store fresh for its owner (banners, sliders, festival campaigns, product and collection updates) without a developer or designer. It never generates a theme from scratch.

## Phase 1: Scanner and store context ✅ (this release)

- Public storefront scan, no credentials needed: identity, theme, products, collections, pages, blog posts.
- Every page read word by word, split into Shopify sections with plain-language labels.
- Pictures of every page and section on computer and phone. Brand colours and fonts measured in a real browser.
- Health check in plain language. "What changed since last time".
- **Store context folder** (`data/store-context/`) so any person or AI model can continue without rescanning ([format](CONTEXT-FORMAT.md)).
- Optional read-only admin scan: exact editable texts and images per section, theme palette and fonts, images built into theme code.
- Web UI for non-technical owners. Local memory in SQLite.
- Strictly **read-only**: nothing on the store is changed.

## Phase 2: Connect an AI model (planned)

- Pick any frontier model provider (text, vision, images) in Settings; bring your own API key.
- The model reads the store context instead of rescanning. A local "brand profile" (voice, palette, banner patterns) is learned once from `STORE.md`, the pictures and `NOTES.md`.
- Ask questions in plain language ("which products need better photos?") and get suggestions.
- Region and festival presets chosen by the operator (e.g. India, US, UK, Gulf, plus custom dates) with lead-time reminders.
- Cost-conscious by design: rules and the scan do most of the work; models are only called for creative and judgement tasks.

## Phase 3: Safe changes with approval (planned)

- Every change is a **proposal** the owner reviews first: exact before/after text, new images, which section it touches.
- Changes go to a **draft copy of the live theme** first (`themeDuplicate`), with a preview link. Publish only after approval.
- Edits are targeted at theme JSON settings by section key and setting (the editable settings the admin scan already finds), not free-form code edits.
- Every write is snapshotted locally for one-click rollback. Conflict detection if the theme changed since the proposal.
- Festival campaigns with end dates that propose reverting themselves afterwards.
- New products and collections created as drafts.

## Phase 4: Creative automation (planned)

- Banner and slider images generated in the store's own style, sized for each section, uploaded to Shopify Files.
- Headings, sub-text and buttons written in the brand voice and chosen language.
- Seasonal calendar running on its own, asking the owner only for approval.

Ideas and pull requests are welcome. Please keep the owner in control: nothing reaches the live store without approval.
