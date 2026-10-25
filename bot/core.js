// Scheduled Telegram bot: scans the shop, compares with the last run, and sends
// new deals, price drops and restocks. Node 18+, no dependencies.
'use strict';
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const price = v => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') { for (const k of ['value', 'amount', 'text', 'defaultValue']) { const p = price(v[k]); if (p > 0) return p; } return 0; }
  const m = String(v).replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? +m[0] : 0;
};
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brandOf = t => (String(t).trim().split(/\s+/)[0] || '').replace(/[^\w&'-]/g, '');
const score = p => p.disc + Math.min(30, (p.mrp - p.price) / 8);

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

// India time, for the morning digest.
function ist() {
  const d = new Date(Date.now() + 5.5 * 3600e3);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

async function telegram(fetch, token, chat, text) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    if (r.ok) return;
    const j = await r.json().catch(() => ({}));
    if (r.status === 429 && j.parameters && j.parameters.retry_after) { await sleep((j.parameters.retry_after + 1) * 1000); continue; }
    throw new Error('Telegram: ' + (j.description || 'HTTP ' + r.status));
  }
  throw new Error('Telegram: rate limited');
}

const line = (p, label) => `<b>${p.disc}% off</b> · ${esc(p.title.slice(0, 90))}\n${inr(p.price)} <s>${inr(p.mrp)}</s>${p.was ? ' · was ' + inr(p.was) : ''}${p.url ? `\n<a href="${esc(p.url)}">Open on ${esc(label)}</a>` : ''}`;

// Split into Telegram-sized messages (limit is 4096 characters).
function compose(head, sections, label) {
  const out = [];
  let cur = head;
  for (const [title, items] of sections) {
    if (!items.length) continue;
    let block = `\n\n<b>${title}</b>`;
    for (const p of items) {
      const l = '\n\n' + line(p, label);
      if ((cur + block + l).length > 3900) { out.push(cur + block); cur = head; block = `\n\n<b>${title} (continued)</b>`; }
      block += l;
    }
    cur += block;
  }
  if (cur !== head) out.push(cur);
  return out;
}

function thresholds(env) {
  const map = {};
  for (const part of String(env.THRESHOLDS || '').split(',')) {
    const m = part.trim().match(/^([\w-]+)\s*[=:]\s*(\d+)$/);
    if (m) map[m[1]] = +m[2];
  }
  return map;
}

async function run(platform, argv = process.argv.slice(2)) {
  loadEnv(path.join(ROOT, '.env'));
  const env = process.env;
  const fetch = platform.fetch || globalThis.fetch;
  const dry = argv.includes('--dry-run') || env.DRY_RUN === 'true';
  const token = env.TELEGRAM_BOT_TOKEN, chat = env.TELEGRAM_CHAT_ID;
  if (!dry && (!token || !chat)) {
    console.log('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set, so there is nothing to do. See README → Telegram bot.');
    return 0;
  }
  const missing = (platform.required || []).filter(k => !env[k]);
  if (missing.length) { console.error('Missing settings: ' + missing.join(', ') + '. See README → Telegram bot.'); return 1; }

  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const only = String(env.GROUPS || '').split(',').map(s => s.trim()).filter(Boolean);
  const per = thresholds(env), base = +env.MIN_DISCOUNT || 0;
  const pages = Math.max(1, Math.min(5, +env.PAGES || cfg.pages || 1));
  const jobs = [];
  for (const g of cfg.groups) {
    if (only.length && !only.includes(g.id)) continue;
    const min = per[g.id] || base || g.minDiscount || cfg.minDiscount || 60;
    for (const sub of g.subs) jobs.push({ g, sub, min });
  }

  const found = new Map();
  let failed = 0, blocked = '';
  const ctx = { env, fetch, sleep, price, brandOf };
  await pool(jobs, +env.MAX_WORKERS || platform.workers || 4, async job => {
    for (let page = 1; page <= pages && !blocked; page++) {
      let items;
      try { items = await platform.fetchPage(job, page, ctx); }
      catch (e) {
        if (e.blocked) blocked = e.message; else { failed++; console.log(`  ! ${job.g.name} › ${job.sub[1]}: ${e.message}`); }
        return;
      }
      for (const p of items) { if (!found.has(p.id) || job.min < found.get(p.id).min) found.set(p.id, Object.assign(p, { min: job.min })); }
      if (items.more === false || !items.length) break;
      // Only stores that return results sorted by discount can stop early.
      if (platform.sortedByDiscount && (items.length < (platform.pageSize || 10) || items[items.length - 1].disc < job.min)) break;
    }
  });
  if (blocked) console.error('Stopped: ' + blocked);
  console.log(`Scanned ${jobs.length} aisles · ${found.size} products${failed ? ` · ${failed} failed` : ''}`);
  if (!found.size) return blocked || failed === jobs.length ? 1 : 0;

  const stateFile = path.join(ROOT, 'data', 'state.json');
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { /* first run */ }
  st.items = st.items || {};
  const now = ist();
  const digestHour = env.DIGEST_HOUR_IST === undefined || env.DIGEST_HOUR_IST === '' ? 9 : +env.DIGEST_HOUR_IST;
  const digest = digestHour >= 0 && st.digestDate !== now.date && now.hour >= digestHour;

  const fresh = [], drops = [], back = [];
  for (const p of found.values()) {
    const prev = st.items[p.id];
    if (p.inStock && p.disc >= p.min) {
      if (digest || !prev) fresh.push(p);
      else if (p.price < prev.price) { p.was = prev.price; drops.push(p); }
      else if (prev.inStock === false) back.push(p);
    }
    st.items[p.id] = { price: p.price, inStock: p.inStock, t: Date.now() };
  }
  const cutoff = Date.now() - 30 * 864e5;
  for (const [k, v] of Object.entries(st.items)) if (v.t < cutoff) delete st.items[k];
  [fresh, drops, back].forEach(a => a.sort((a1, b1) => score(b1) - score(a1)));

  const max = +env.MAX_ALERTS || 40;
  const total = fresh.length + drops.length + back.length;
  const save = () => { if (dry) return; fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(st)); };
  if (!total) { console.log('No new deals, price drops or restocks. Nothing sent.'); if (digest) st.digestDate = now.date; save(); return 0; }

  const summary = [fresh.length && `${fresh.length} ${digest ? 'deals today' : 'new'}`, drops.length && `${drops.length} cheaper`, back.length && `${back.length} back in stock`].filter(Boolean).join(' · ');
  const head = `<b>PriceDrop Hunter · ${esc(platform.label)}</b>\n${summary}`;
  const msgs = compose(head, [[digest ? 'Morning catalogue' : 'New deals', fresh.slice(0, max)], ['Price drops', drops.slice(0, max)], ['Back in stock', back.slice(0, max)]], platform.label);
  if (dry) {
    msgs.forEach(m => console.log('\n----- message -----\n' + m.replace(/<[^>]+>/g, '')));
    console.log(`\nDry run: ${msgs.length} message(s) not sent, state not saved.`);
    return 0;
  }
  for (const m of msgs) { await telegram(fetch, token, chat, m); await sleep(1100); }
  if (digest) st.digestDate = now.date;
  save();
  console.log(`Sent ${msgs.length} message(s): ${summary}`);
  return 0;
}

module.exports = { run, price, sleep, esc, brandOf, compose };
