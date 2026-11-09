# PriceDrop Hunter for Blinkit — v2

Scans the Blinkit keyword groups and collections you pick and shows the biggest discounts first, then the best deals of each group. It runs in your own browser as a bookmarklet or userscript. Nothing is uploaded and there is no account.

**Live page:** https://stymrj.github.io/Blinkit-Deals/

## What's new in v2 (2026-11-08)

- **Full catalogue:** 28 Blinkit collections (Baby Care, Bath & Body, Atta/Rice/Dal, Dairy, Chips & Namkeen, Sweets, Ice Cream, Electronics, and 20 more — top 3 subcategories each) plus 8 keyword groups — up from 3 collections. Subcategory lists can be refreshed live from `POST /v1/layout/listing` with a `collection_uuid`.
- **Blank-results fix:** a scan that fetches nothing now says why instead of showing an empty grid — no delivery location, Blinkit 403 block, rate limit, or server error. The empty state shows how many products the last scan fetched and the exact fetch problem.
- **Second fetch shape:** a collection that returns nothing is retried once as a keyword search (`/v1/layout/search`) for the subcategory name, instead of reporting an empty aisle.
- **Full listing request body:** `listing_widgets` now sends the complete body the site itself sends (collection filters/properties, snippet types, totals) instead of the short form, and search requests use the site's exact field types (`page_index`/`offset`/`limit` as numbers, `oos_visibility` as `"true"`).
- **Discount-cutoff paging:** pages come back sorted by discount, so paging stops once a page is short or its tail falls below 50% off (or is all sold out) — no more fetching empty pages. Default depth is now 2 pages per category (up to 5 in the picker).
- **In-browser self-test:** a Self-test button in the sidebar runs the parser, the discount cutoff, the fallback decision and the error messages over built-in fixtures and reports pass/fail. Same checks run in `node test-results-tab.js`.
- **JSON export** alongside CSV; CSV building is now a shared helper covered by the test.
- **Bot:** `bot/platform.js` uses the full listing body and cutoff, retries empty collections as keyword searches, and scans **multiple pincodes** — set `BLINKIT_LOCATIONS="lat,lon;lat,lon"` to merge results across delivery areas, deduped by product id; a failing location is skipped instead of failing the run. `bot/config.json` adds Atta/Rice/Dal, Chips & Namkeen and Baby Care collections.
- **Bookmark name fixed:** the install button now reads **Blinkit Deals** instead of the generic “PriceDrop Hunter”, so the bookmark you drag to your bookmarks bar is named after this store.
- **Highest-discount fix:** the parser now reads every price shape the API sends — prices keyed `value` / `max` / `text` instead of only `{text}`, and MRP as a plain number or string. Before, those items dropped entirely (no selling price parsed), or parsed to 0% off when only the MRP was oddly shaped — and a page whose tail parsed to 0% tripped the 50% discount cutoff, so paging stopped and later pages were never fetched. The same fix is in the Telegram bot path. Covered by `fixtures/sample-high-discount.json` and section 7 of `node test-results-tab.js`.

## Why v2 is stronger

The browser tool already had what a plain deal list doesn't, and v2 keeps all of it: price history with a sparkline on every product you've seen, lowest-ever and price-drop labels, saved-item tracking with per-item drop alerts, a cross-category best-deals row, unit price (per kg / litre / piece) with a value sort, one-tap presets, a shopping list with totals, CSV/JSON export, and light/dark themes. On top of that, v2 adds the reliability layer a deal finder needs most: two fetch shapes with a fallback, retries with backoff on 429/5xx, cutoff paging that stops at the 50% discount tail, and diagnostics that name the cause of zero results. The Telegram bot dedupes by product and keeps a 30-day price history (`data/state.json`), so it sends new deals, price drops and restocks — not the same list every run — and now covers several pincodes in one run.

## Features

- Asks which categories to scan, then shows the biggest discounts first
- Best deals of each category in one swipeable row, with See all
- Ranks by percent off and rupees saved together
- Labels products that are new, cheaper than last time, or at their lowest price ever
- Price history sparkline on every product you have seen before
- Saved items strip showing how much each one dropped since you saved it
- Unit price (per kg, litre or piece) with a value sort
- One-tap presets: under ₹99, 50% off, save ₹100+, price drops, lowest ever, best value
- A setup checklist on first open, plus a scan-status line when a scan fetched nothing
- Filters: search, category, brand, maximum price, minimum discount, stock, saved items
- Shopping list with quantities, total and total savings
- CSV and JSON export, copy-to-share text
- Grid and list views, light and dark themes, keyboard shortcuts
- Settings, saved items and price history stay in your browser

## Install

![Install walkthrough](https://stymrj.github.io/PriceDrop-Hunter/media/install-demo.gif)

[Watch the walkthrough video (MP4)](https://stymrj.github.io/PriceDrop-Hunter/media/install-demo.mp4)

**Bookmarklet (desktop).** Run `node build.js`, open `index.html`, and drag the **Blinkit Deals** button to your bookmarks bar. Open blinkit.com and click the bookmark.

**Bookmarklet (mobile).** On the install page, tap **Copy mobile loader**. It is a bookmark of about 380 characters that loads the latest version from GitHub Pages, so it fits on any phone. Create a bookmark named **Blinkit Deals**, paste it as the address, and run it from the address bar on blinkit.com. The full bookmarklet (about 64 KB, no network needed) is in `dist/bookmarklet.txt`.

**Userscript.** Install `dist/blinkit-deals.user.js` in Tampermonkey or Violentmonkey. A small Deals button appears on every blinkit.com page.

## Use

Pick categories in the picker, press Scan, and watch deals arrive — 2 categories fetch in parallel with a progress bar. Items are deduped across pages, categories and (in the bot) pincodes. Press **Self-test** in the sidebar any time to check the parser without scanning.

Keyboard shortcuts: `/` search, `S` scan or stop, `Esc` close.

## Telegram alerts (browser)

Hunter can send new deals, price drops and cheaper saved items to your Telegram.

1. In Telegram, open `@BotFather`, send `/newbot`, and copy the bot token.
2. Open your new bot and press **Start**.
3. Get your chat ID from `@userinfobot`, or open `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id`.
4. On the store, open Hunter, press **Telegram** in the top bar, paste the token and chat ID, press **Send test**, then switch alerts on.

Each deal is sent once, and again only if its price drops further. Use the userscript for alerts: some shops block bookmarklets from calling Telegram, while the userscript sends through `GM_xmlhttpRequest`. The token is stored only in your browser.

## Telegram bot (GitHub Actions)

Hunter can also run on its own, without a browser, on GitHub Actions. Every 30 minutes it scans Blinkit, compares with the previous run (kept in `data/state.json`), and sends what changed to Telegram: a morning catalogue, new deals, price drops, and back-in-stock items. Identical prices are not re-sent.

1. Fork [github.com/stymrj/Blinkit-Deals](https://github.com/stymrj/Blinkit-Deals).
2. Create a bot with `@BotFather` (`TELEGRAM_BOT_TOKEN`) and get your chat ID from `@userinfobot` (`TELEGRAM_CHAT_ID`).
3. Find your delivery coordinates: open Google Maps, right-click your delivery address — the first line shows them, e.g. `12.9716, 77.5946`. That's `BLINKIT_LAT` / `BLINKIT_LON`. For several pincodes, set the **Variable** `BLINKIT_LOCATIONS` to `lat,lon;lat,lon` instead. Optional: copy the **cookie** header from a logged-in blinkit.com tab into `BLINKIT_COOKIE` if plain requests are refused.
4. In your fork, add the secrets above, and set the **Variable** `BOT_ENABLED` = `true`.
5. In **Actions**, enable workflows, run **Telegram deal alerts** with **Print the messages instead of sending them** ticked to preview, then run it again for real.

> **Important:** Blinkit usually blocks GitHub's cloud servers. If the run log says *blocked (HTTP 403)*, use a self-hosted runner on your own computer: **Settings → Actions → Runners → New self-hosted runner**, then set the **Variable** `RUNNER` = `self-hosted`.

Optional variables: `MIN_DISCOUNT`, `THRESHOLDS` (e.g. `grocery=55,snacks=65`), `GROUPS`, `PAGES` (1–5), `DIGEST_HOUR_IST`, `RUNNER`. Groups and thresholds live in `bot/config.json`.

Local run: `cp .env.example .env`, then `node bot/run.js --dry-run` (prints, sends nothing) or `node bot/run.js`. Node 18+, no `npm install` needed.

A session cookie works like your password for that site. Keep it only in GitHub **Secrets** or your local `.env` (already in `.gitignore`), never in a commit or an issue. If one ever leaks, log out of all devices on Blinkit to cancel it.

## How it gets data

Uses Blinkit's own web endpoints (`/v1/layout/search` and `/v1/layout/listing_widgets`, sorted by discount) from your tab, with the delivery coordinates Blinkit saved. Requests are paced (two at a time, short random pauses, back-off on HTTP 429) because Blinkit rate-limits bursts.

## Troubleshooting

- **Blank results / "0 products":** read the message under the checklist — it names the cause. Open blinkit.com, set your delivery address, then scan again (or enter latitude and longitude in the sidebar).
- **HTTP 403:** Blinkit blocked the request — usually a datacentre IP. Retry from your own blinkit.com tab; for the bot, use a self-hosted runner.
- **Rate limited (429):** wait a few minutes and retry; the scan already backs off and retries.
- **Only some categories empty:** that aisle may genuinely have no deals at your minimum discount — lower it, or pick fewer categories for a faster scan (28 collections × 2 pages takes a while).
- **Telegram test fails in the bookmarklet:** install the userscript; some shops block bookmarklets from calling Telegram.

## Testing

```bash
node --check src/deals.js bot/platform.js bot/core.js   # syntax
node test-results-tab.js                                # 31 checks: 70-item fixture -> 70 cards, cutoff, fallback, retries, diagnostics, CSV, unit price
node test/bot-platform.test.js                          # 8 checks: bot fetch layer (multi-pincode, fallback, cutoff) with stubbed fetch
node build.js                                           # rebuilds dist/ and index.html
```

The browser tests use fixtures, not the live site: the parser, fallback, cutoff and error paths are verified offline. Live Blinkit endpoints still need a manual browser test — set your address, scan a category, and confirm cards appear.

## Limitations

- Prices and stock depend on your local Blinkit store.
- A full scan takes about a minute because of the pacing; deals appear as they arrive.
- The endpoints are undocumented and can change.

## Project layout

```
src/deals.js         the app (one file, no dependencies)
src/index.tpl.html   install page template
fixtures/            sample layout payload used by the regression test
test/                bot platform test (stubbed fetch)
bot/                 Telegram bot: run.js, core.js, platform.js, config.json
.github/workflows/   telegram-bot.yml (every 30 minutes)
.env.example         settings for local runs (incl. BLINKIT_LOCATIONS)
build.js             builds dist/ and index.html
```

Run `node build.js` after any change.

## License

MIT — see `LICENSE`. The fetch layer adapts MIT-licensed code; the original copyright notice is preserved in `LICENSE`.

---

Made with ♥ by [Satyam Raj](https://www.linkedin.com/in/satyamraj1)
