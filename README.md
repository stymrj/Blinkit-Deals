# PriceDrop Hunter for Blinkit

Sweeps Blinkit through keyword searches and collection listings, ranks products by real savings, and tracks price changes between scans. It runs in your own browser as a bookmarklet or userscript. Nothing is uploaded and there is no account.

**Live page:** https://stymrj.github.io/Blinkit-Deals/

## Features

- Ranks by percent off and rupees saved together
- Labels products that are new, cheaper than last time, or at their lowest price ever
- Price history sparkline on every product you have seen before
- Saved items strip showing how much each one dropped since you saved it
- Unit price (per kg, litre or piece) with a value sort
- One-tap presets: under ₹99, 50% off, save ₹100+, price drops, lowest ever, best value
- A setup checklist on first open
- Filters: search, category, brand, maximum price, minimum discount, stock, saved items
- Shopping list with quantities, total and total savings
- CSV export and copy-to-share text
- Grid and list views, light and dark themes, keyboard shortcuts
- Settings, saved items and price history stay in your browser

## Install

**Bookmarklet (desktop).** Run `node build.js`, open `index.html`, and drag the button to your bookmarks bar. Open blinkit.com and click the bookmark.

**Bookmarklet (mobile).** On the install page, tap **Copy mobile loader**. It is a bookmark of about 380 characters that loads the latest version from GitHub Pages, so it fits on any phone. Create a bookmark, paste it as the address, and run it from the address bar on blinkit.com. The full bookmarklet (about 45 KB, no network needed) is in `dist/bookmarklet.txt`.

**Userscript.** Install `dist/blinkit-deals.user.js` in Tampermonkey or Violentmonkey. A small Deals button appears on every blinkit.com page.

## Keyboard shortcuts

`/` search, `S` scan or stop, `Esc` close.

## Telegram alerts

Hunter can send new deals, price drops and cheaper saved items to your Telegram.

1. In Telegram, open `@BotFather`, send `/newbot`, and copy the bot token.
2. Open your new bot and press **Start**.
3. Get your chat ID from `@userinfobot`, or open `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id`.
4. In Hunter's sidebar, open **Telegram alerts**, paste the token and chat ID, press **Send test message**, then switch alerts on.
5. Optional: set **Auto-scan** (for example every 15 minutes) and keep the tab open.

Each deal is sent once, and again only if its price drops further. Use the userscript for alerts: some shops block bookmarklets from calling Telegram, while the userscript sends through `GM_xmlhttpRequest`. The token is stored only in your browser.

## Telegram bot (GitHub Actions)

Hunter can also run on its own, without a browser, on GitHub Actions. Every 30 minutes it scans Blinkit, compares with the previous run, and sends what changed to Telegram.

| | Browser tool | Telegram bot |
| :--- | :--- | :--- |
| Runs | In your browser tab | On GitHub Actions (free for public repos) |
| When | When you open it, or auto-scan while the tab is open | Every 30 minutes, 08:31 to 00:01 IST |
| Uses | Your open Blinkit session | A copy of your session stored as a GitHub secret |
| Alerts | New deals, price drops, saved items | New deals, price drops, back in stock, a morning catalogue |

### What gets sent

- **Morning catalogue:** the first run after 9 AM IST sends every deal above your threshold.
- **New deals:** products seen for the first time that meet the threshold.
- **Price drops:** products that are cheaper than the last run.
- **Back in stock:** qualifying products that were out of stock last run.
- **Nothing else:** identical prices are not re-sent, and if nothing changed the bot stays silent.

### Step 1: Copy the repository

Click **Fork** at the top of [github.com/stymrj/Blinkit-Deals](https://github.com/stymrj/Blinkit-Deals). Everything below happens in your fork.

### Step 2: Create your Telegram bot

1. In Telegram, open `@BotFather`, send `/newbot`, and follow the prompts. Copy the token it gives you. This is `TELEGRAM_BOT_TOKEN`.
2. Open your new bot and press **Start**.
3. Open `@userinfobot` and press **Start**. Copy the number it shows. This is `TELEGRAM_CHAT_ID`.

To post into a channel instead, add the bot to the channel as an admin and use the channel's `@username` as `TELEGRAM_CHAT_ID`.

### Step 3: Find your delivery coordinates

1. Open Google Maps and right-click your delivery address. The first line of the menu shows the coordinates, for example `12.9716, 77.5946`.
2. The first number is `BLINKIT_LAT`, the second is `BLINKIT_LON`.
3. Optional: if Blinkit refuses plain requests, copy the **cookie** request header from a logged-in blinkit.com tab (DevTools → Network) into `BLINKIT_COOKIE`.

> **Important:** Blinkit usually blocks GitHub's cloud servers. If the run log says *blocked (HTTP 403)*, use a self-hosted runner on your own computer (Step 6).

### Step 4: Add the secrets

In your fork, open **Settings → Secrets and variables → Actions → Secrets** and add:

| Secret | Required | What it is |
| :--- | :---: | :--- |
| `TELEGRAM_BOT_TOKEN` | Yes | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Your chat ID from @userinfobot, or a channel `@username` |
| `BLINKIT_LAT` | Yes | Latitude of your delivery address, for example 12.9716. |
| `BLINKIT_LON` | Yes | Longitude of your delivery address, for example 77.5946. |
| `BLINKIT_COOKIE` | No | Cookie header from blinkit.com, if plain requests are refused. |

Then open the **Variables** tab and add `BOT_ENABLED` = `true`. Scheduled runs only start once this is set.

Optional variables:

| Variable | Default | What it does |
| :--- | :--- | :--- |
| `MIN_DISCOUNT` | per group | One threshold for every group, for example `65` |
| `THRESHOLDS` | see `bot/config.json` | Per-group thresholds, for example `grocery=55,snacks=65` |
| `GROUPS` | all | Only scan these groups, for example `grocery,snacks` |
| `PAGES` | `2` | Pages per aisle, 1 to 5 |
| `DIGEST_HOUR_IST` | `9` | Hour of the morning catalogue; `-1` turns it off |
| `RUNNER` | `ubuntu-latest` | Set to `self-hosted` to run on your own computer |

### Step 5: Enable and test

1. Open the **Actions** tab. GitHub pauses workflows in new forks: click **I understand my workflows, go ahead and enable them**.
2. Choose **Telegram deal alerts** → **Run workflow**, tick **Print the messages instead of sending them**, and run it. Open the run to see what would be sent.
3. Run it again without the tick. Your first alert arrives on Telegram within a minute or two.

From then on it runs every 30 minutes by itself. GitHub sometimes starts scheduled runs late, and it pauses schedules in repositories with no activity for 60 days; re-enable them from the Actions tab if that happens.

### Step 6 (if blocked): run it on your own computer

GitHub's servers share IP addresses that some shops block. A self-hosted runner runs the same workflow on your computer, from your home connection.

1. In your repository: **Settings → Actions → Runners → New self-hosted runner**, choose your OS, and run the commands it shows.
2. In **Settings → Secrets and variables → Actions → Variables**, add `RUNNER` = `self-hosted`.
3. Keep that computer on (and the runner running) during the hours you want alerts.

Node 18 or newer must be installed on that computer.

### Customising

Groups, aisles and default thresholds live in `bot/config.json`:

```json
{ "id": "grocery", "name": "Grocery & Staples", "minDiscount": 60, "subs": [["atta", "Atta"]] }
```

Add or remove entries under `subs`, change `minDiscount`, commit, and the next run uses them.

### Run it on your computer

```bash
cp .env.example .env        # fill in the values from steps 2 and 3
node bot/run.js --dry-run   # prints the messages, sends nothing
node bot/run.js             # sends to Telegram and remembers this run in data/state.json
```

Node 18 or newer, no `npm install` needed.

### Keep your session safe

A session cookie works like your password for that site. Keep it only in GitHub **Secrets** or your local `.env` (already in `.gitignore`), never in a commit or an issue. GitHub hides secrets in run logs. If one ever leaks, log out of all devices on Blinkit to cancel it.

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
bot/                 Telegram bot: run.js, core.js, platform.js, config.json
.github/workflows/   telegram-bot.yml (every 30 minutes)
.env.example         settings for local runs
build.js             builds dist/ and index.html
favicon.svg
```

Run `node build.js` after any change.

---

Made with ♥ by [Satyam Raj](https://www.linkedin.com/in/satyamraj1)
