# PriceDrop Hunter for Blinkit

Sweeps Blinkit through keyword searches and collection listings, ranks products by real savings, and tracks price changes between scans. It runs in your own browser as a bookmarklet or userscript. Nothing is uploaded and there is no account.

**Live page:** https://stymrj.github.io/Blinkit-Deals/

## Features

- Ranks by percent off and rupees saved together
- Labels products that are new or cheaper than your last scan
- Filters: search, category, brand, maximum price, minimum discount, stock, saved items
- Shopping list with quantities, total and total savings
- CSV export and copy-to-share text
- Grid and list views, light and dark themes, keyboard shortcuts
- Settings, saved items and price history stay in your browser

## Install

**Bookmarklet (desktop).** Run `node build.js`, open `index.html`, and drag the button to your bookmarks bar. Open blinkit.com and click the bookmark.

**Bookmarklet (mobile).** Copy the code from the page, create a bookmark, and paste the code as its address. Run it from the address bar on blinkit.com.

**Userscript.** Install `dist/blinkit-deals.user.js` in Tampermonkey or Violentmonkey. A small Deals button appears on every blinkit.com page.

**Demo.** Use "Try the demo" on the install page to explore the interface with sample data.

## Keyboard shortcuts

`/` search, `S` scan or stop, `Esc` close.

## How it gets data

Uses Blinkit's own web endpoints (`/v1/layout/search` and `/v1/layout/listing_widgets`) from your logged-in session. Latitude and longitude are read from the page, or entered in the sidebar.

## Limitations

- Prices and stock depend on your local store.
- The three collection groups use best-effort request bodies; the keyword groups are the primary path.
- The endpoints are undocumented and can change.

## Project layout

```
src/deals.js         the app (one file, no dependencies)
src/index.tpl.html   install page template
build.js             builds dist/ and index.html
favicon.svg
```

Run `node build.js` after any change.

---

Made with ♥ by [Satyam Raj](https://www.linkedin.com/in/satyamraj1)
