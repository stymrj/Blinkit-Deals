# Changelog

## v2.0.0 — 2026-11-08
- Fixed (2026-11-09): install button now reads “Blinkit Deals” instead of the generic “PriceDrop Hunter”, so the dragged bookmark is named after this store instead of colliding with every other tool.
- Fixed (2026-11-09): highest-discount items are fetched again — the parser now reads prices keyed `value` / `max` / `text` instead of only `{text}`, and MRP as a plain number or string. Those shapes used to drop the item entirely (no selling price parsed), or parse to 0% off when only the MRP was oddly shaped — and a page whose tail parsed to 0% tripped the 50% discount cutoff, so paging stopped and later pages were never fetched. Same fix in the Telegram bot path (`bot/core.js` price, `bot/platform.js` normalise); covered by `fixtures/sample-high-discount.json`, section 7 of `test-results-tab.js`, and `test/bot-platform.test.js`.

- Full catalogue: 28 Blinkit collections (top 3 subcategories each) plus 8 keyword groups (was 3 collections); subcategory lists refreshable live from `POST /v1/layout/listing`.
- Blank-results fix: empty scans now report the cause (no delivery location, HTTP 403 block, rate limit, server error) with a fetched-count status line, instead of an empty grid.
- Second fetch shape: a collection that returns nothing is retried once as a keyword search (`/v1/layout/search`) for the subcategory name.
- Full `listing_widgets` request body (collection filters/properties, snippet types, totals) and exact search field types (`page_index`/`offset`/`limit` as numbers, `oos_visibility` as `"true"`).
- Discount-cutoff paging: stops once a page is short or its tail falls below 50% off (or is all sold out); default depth 2 pages per category (max 5).
- In-browser Self-test button (parser, cutoff, fallback, error messages, paging) — same checks as `node test-results-tab.js`.
- JSON export alongside CSV; `test-results-tab.js` regression test (70-item fixture → 70 cards) and `test/bot-platform.test.js` (bot fetch layer).
- Bot: full listing body and cutoff, empty-collection search fallback, and multi-pincode scanning via `BLINKIT_LOCATIONS` (results merged, deduped by id; a failing location is skipped); Atta / Chips / Baby Care collections added to `bot/config.json`.
