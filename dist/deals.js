/*!
 * PriceDrop Hunter for Blinkit
 * Runs in your own browser session as a bookmarklet or userscript.
 * Demo mode (sample data) is used on any other site.
 */
(function () {
  'use strict';
  if (window.__BDS__) { window.__BDS__.toggle(); return; }

  // ───────────────────────── Utils ─────────────────────────
  const $inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };

  const price = v => { if (v == null) return 0; if (typeof v === 'number') return v; const m = String(v).replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? +m[0] : 0; };
  const guessBrand = t => (String(t).trim().split(/\s+/)[0] || '').replace(/[^\w&'-]/g, '');
  const EXCLUDED = [];
  const allowed = p => { const t = p.title.toLowerCase(); return !EXCLUDED.some(k => t.includes(k)); };
  const KWG = (id, name, kws) => ({ id, name, subs: kws.map(k => [k, k[0].toUpperCase() + k.slice(1)]) });

  // ───────────────────────── Catalogue ─────────────────────────
  const GROUPS = [
    KWG('grocery', 'Grocery & Staples', ['atta', 'rice', 'dal', 'oil', 'ghee', 'sugar', 'salt', 'masala']),
    KWG('snacks', 'Snacks & Sweets', ['chips', 'biscuits', 'namkeen', 'chocolate', 'ice cream', 'noodles']),
    KWG('drinks', 'Drinks', ['tea', 'coffee', 'juice', 'cold drink', 'water']),
    KWG('dairy', 'Dairy & Bread', ['milk', 'paneer', 'curd', 'butter', 'cheese', 'eggs', 'bread']),
    KWG('care', 'Personal Care', ['shampoo', 'soap', 'toothpaste', 'face wash', 'diaper', 'sanitary']),
    KWG('home', 'Home & Cleaning', ['detergent', 'dishwash', 'cleaner', 'tissue', 'mop']),
    KWG('fresh', 'Fresh', ['fruits', 'vegetables', 'onion', 'tomato', 'potato']),
    KWG('tech', 'Electronics', ['charger', 'earphones', 'cable', 'battery', 'power bank']),
    { id: 'baby', name: 'Baby Care (collection)', uuid: 'OTg3NjU0MzIxMjM0NTMzMzk=', subs: [['46757', 'Diaper & Wipes'], ['20667', 'Baby Food']] },
    { id: 'atta', name: 'Atta, Rice & Dal (collection)', uuid: 'OTg3NjU0MzIxMjM0NTMzNjk=', subs: [['16426', 'Atta'], ['16431', 'Local Rice']] },
    { id: 'chips', name: 'Chips & Namkeen (collection)', uuid: 'OTg3NjU0MzIxMjM0NTMzNjg=', subs: [['11402', 'Chips & Wafers'], ['11405', 'Bhujia & Mixtures']] }
  ];
  let noLoc = false;
  const cookie = n => { try { const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; } };
  const loc = () => ({ lat: store.lat || cookie('gr_1_lat'), lon: store.lon || cookie('gr_1_lon') });
  const txt = v => (v && typeof v === 'object' ? v.text : v);
  function normalise(o, cat) {
    const d = o.data, ci = (d.atc_action && d.atc_action.add_to_cart && d.atc_action.add_to_cart.cart_item) || {};
    const title = txt(d.name) || ci.display_name || ci.product_name;
    const sell = price(txt(d.normal_price) || ci.price);
    let mrp = price(txt(d.mrp) || ci.mrp);
    if (!title || !sell) return null;
    if (mrp < sell) mrp = sell;
    const unit = txt(d.variant) || ci.unit || '';
    const img0 = (d.image && (d.image.url || d.image)) || ci.image_url || '';
    const img = typeof img0 === 'string' && img0.indexOf('https://') === 0 ? img0 : '';
    const pid = d.product_id || ci.product_id || (title + '|' + sell);
    const oos = d.is_sold_out === true || ci.inventory === 0 || d.inventory === 0;
    const brand = txt(d.brand_name) || d.brand || ci.brand || guessBrand(title);
    const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return { id: String(pid), title: String(title) + (unit ? ' · ' + unit : ''), brand: String(brand), price: sell, mrp, disc: mrp > sell ? Math.round((mrp - sell) / mrp * 100) : 0, save: mrp - sell, img, url: 'https://blinkit.com/prn/' + slug + '/prid/' + pid, inStock: !oos, cat };
  }
  function extract(json, cat) {
    const out = [], seen = new Set();
    (function walk(o, d) {
      if (!o || typeof o !== 'object' || d > 16) return;
      if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
      if (o.data && typeof o.data === 'object' && (o.data.name || o.data.normal_price || o.data.atc_action)) {
        const p = normalise(o, cat);
        if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); return; }
      }
      for (const k in o) walk(o[k], d + 1);
    })(json, 0);
    return out;
  }
  async function fetchPage(job, page, ctl) {
    const { lat, lon } = loc();
    if (!lat || !lon) { noLoc = true; return []; }
    const offset = (page - 1) * 15, pi = String(page - 1);
    let url, body;
    if (job.kind === 'search') {
      url = 'https://blinkit.com/v1/layout/search?q=' + encodeURIComponent(job.q) + '&search_type=type_to_search&page_index=' + pi + '&offset=' + offset + '&limit=15&oos_visibility=true&sort=discount_desc';
      body = { query: job.q, q: job.q, search_query: job.q, page_index: pi, offset: String(offset), limit: '15', oos_visibility: true, sort: 'discount_desc' };
    } else {
      url = 'https://blinkit.com/v1/layout/listing_widgets?collection_uuid=' + encodeURIComponent(job.uuid) + '&collection_group_id=' + job.gid + '&sort=discount_desc';
      body = { offset: String(offset), limit: '15', collection_uuid: job.uuid, collection_group_id: job.gid, page_index: pi, oos_visibility: true, sort: 'discount_desc' };
    }
    let lastErr;
    for (let a = 0; a < 3; a++) {
      if (ctl.stop) throw new Error('stopped');
      try {
        const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', accept: '*/*', app_client: 'consumer_web', lat: String(lat), lon: String(lon) }, body: JSON.stringify(body) });
        if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
        if (!r.ok) { noLoc = true; return []; }
        return extract(await r.json(), job.g.name + ' › ' + job.name);
      } catch (e) { lastErr = e; await sleep(700 * (a + 1)); }
    }
    throw lastErr;
  }
  const P = {
    key: 'bds_v1', hostRe: /(^|\.)blinkit\.com$/,
    defaults: { groups: ['grocery', 'snacks', 'dairy'], lat: '', lon: '', depth: 3 },
    jobs: st => {
      const jobs = [];
      for (const g of GROUPS) {
        if (!st.groups.includes(g.id)) continue;
        for (const [c, n] of g.subs) jobs.push(g.uuid ? { g, name: n, kind: 'list', uuid: g.uuid, gid: c } : { g, name: n, kind: 'search', q: c });
      }
      return jobs;
    },
    fetchPage,
    noLocation: () => noLoc,
    noLocMsg: 'No results. Open blinkit.com, set your delivery address, then scan again (or enter latitude and longitude in the sidebar).',
    locUI: (st, e) => `<label class="row" style="margin-bottom:8px"><span>Latitude</span><input class="fld" style="width:120px" data-in="lat" placeholder="auto" value="${e(st.lat)}" inputmode="decimal"></label>
  <label class="row" style="margin-bottom:8px"><span>Longitude</span><input class="fld" style="width:120px" data-in="lon" placeholder="auto" value="${e(st.lon)}" inputmode="decimal"></label>`,
    locInput: (k, v) => { if (k === 'lat' || k === 'lon') { store[k] = v.replace(/[^\d.\-]/g, '').slice(0, 12); save(); return true; } return false; }
  };
  const DEMO = !!window.__BDS_DEMO__ || !P.hostRe.test(location.hostname);

  const KEY = P.key;
  const defaults = Object.assign({
    theme: 'auto', view: 'grid', sort: 'score', minDisc: 30, maxPrice: 0, depth: 3,
    stockOnly: true, favs: [], hidden: [], list: {}, prices: {}, lastScan: 0
  }, P.defaults);
  let store;
  try { store = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { store = Object.assign({}, defaults); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* quota/private mode */ } };

  // ───────────────────────── Demo data ─────────────────────────
  function demoFetch(groupId, subName, page) {
    let seed = 0; const key = groupId + subName + page;
    for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const brands = ['Amul', 'Tata', 'Nestlé', 'Britannia', 'Aashirvaad', 'Fortune', 'Haldiram', 'Dabur', 'Surf', 'Maggi', 'Cadbury', 'Pepsi', 'Real', 'Godrej', 'Patanjali', 'Lays'];
    const words = ['Premium', 'Classic', 'Value Pack', 'Family Pack', 'Fresh', 'Organic', 'Combo', 'Select', 'Mega Pack'];
    const g = GROUPS.find(x => x.id === groupId) || GROUPS[0];
    const items = [];
    const n = page > 2 ? 4 : 12;
    for (let i = 0; i < n; i++) {
      const mrp = Math.round(40 + rnd() * 900);
      const disc = Math.round(8 + rnd() * rnd() * 70 + (rnd() < 0.05 ? 15 : 0));
      const sell = Math.max(5, Math.round(mrp * (1 - disc / 100)));
      const brand = brands[Math.floor(rnd() * brands.length)];
      const hue = Math.floor(rnd() * 360);
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><rect width='240' height='240' fill='hsl(${hue},38%,90%)'/><text x='50%' y='58%' font-family='Georgia,serif' font-size='110' fill='hsl(${hue},35%,42%)' text-anchor='middle'>${brand[0]}</text></svg>`;
      items.push({
        id: `${groupId}-${subName}-${page}-${i}`, title: `${brand} ${subName} ${words[Math.floor(rnd() * words.length)]} ${[100, 250, 500, 1000][Math.floor(rnd() * 4)]}g`,
        brand, price: sell, mrp, disc: sell < mrp ? Math.round((mrp - sell) / mrp * 100) : 0, save: mrp - sell,
        img: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), url: '#demo', inStock: rnd() > 0.12, cat: g.name + ' › ' + subName
      });
    }
    return items;
  }

  // ───────────────────────── State ─────────────────────────
  const S = { products: new Map(), scanning: false, done: 0, total: 0, errors: 0, ctl: { stop: false },
    q: '', brand: '', cat: '', favOnly: false, newOnly: false, shown: 60, tab: 'deals', panel: false, startedAt: 0 };

  // ───────────────────────── Scanner ─────────────────────────
  async function scan() {
    if (S.scanning) return;
    const jobs = P.jobs(store);
    if (!jobs.length) { toast('Pick at least one category'); return; }
    S.scanning = true; S.ctl = { stop: false }; S.done = 0; S.errors = 0; S.total = jobs.length; S.startedAt = Date.now();
    S.products.clear(); S.shown = 60; render();
    const ctl = S.ctl, queue = jobs.slice();
    const worker = async () => {
      while (queue.length && !ctl.stop) {
        const job = queue.shift();
        try {
          for (let page = 1; page <= store.depth && !ctl.stop; page++) {
            let items;
            if (DEMO) { await sleep(120 + Math.random() * 260); items = demoFetch(job.g.id, job.name, page); }
            else items = await P.fetchPage(job, page, ctl);
            const fresh = ingest(items);
            scheduleRender();
            if (fresh < 3) break;
            if (items.length && items[items.length - 1].disc < Math.min(store.minDisc, 20)) break; // sorted by discount: rest is below threshold
          }
        } catch (e) { if (!ctl.stop) S.errors++; }
        S.done++; scheduleRender();
      }
    };
    await Promise.all(Array.from({ length: (typeof P !== 'undefined' && P.workers) || 5 }, worker));
    S.scanning = false;
    const prices = store.prices;
    S.products.forEach(p => { prices[p.id] = p.price; });
    const ids = Object.keys(prices);
    if (ids.length > 6000) ids.slice(0, ids.length - 6000).forEach(k => delete prices[k]);
    store.lastScan = Date.now(); save(); render();
    if (P.noLocation() && !S.products.size) { toast(P.noLocMsg); return; }
    toast(ctl.stop ? 'Scan stopped' : `Scan complete · ${S.products.size} products` + (S.errors ? ` · ${S.errors} failed` : ''));
  }

  // ───────────────────────── Filtering ─────────────────────────
  const score = p => p.disc + Math.min(30, p.save / 8);
  const SORTS = {
    score: ['Best deal', (a, b) => score(b) - score(a)],
    disc: ['Highest discount', (a, b) => b.disc - a.disc || b.save - a.save],
    save: ['Biggest saving ₹', (a, b) => b.save - a.save],
    pasc: ['Price: low → high', (a, b) => a.price - b.price],
    pdesc: ['Price: high → low', (a, b) => b.price - a.price],
    name: ['Name A–Z', (a, b) => a.title.localeCompare(b.title)]
  };
  function filtered() {
    const q = S.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const fav = new Set(store.favs), hid = new Set(store.hidden);
    const out = [];
    S.products.forEach(p => {
      if (hid.has(p.id)) return;
      if (store.stockOnly && !p.inStock) return;
      if (p.disc < store.minDisc) return;
      if (store.maxPrice && p.price > store.maxPrice) return;
      if (S.brand && p.brand !== S.brand) return;
      if (S.cat && p.cat.split(' › ')[0] !== S.cat) return;
      if (S.favOnly && !fav.has(p.id)) return;
      if (S.newOnly && !p.isNew && !p.was) return;
      if (q.length) { const t = (p.title + ' ' + p.cat).toLowerCase(); if (!q.every(w => t.includes(w))) return; }
      out.push(p);
    });
    return out.sort(SORTS[store.sort][1]);
  }

  // ───────────────────────── UI ─────────────────────────
  const PLATFORM = 'Blinkit';
  const host = document.createElement('div');
  host.id = 'fkm-host';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:none';
  const root = host.attachShadow({ mode: 'open' });
  const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0}
.app{--bg:#fafaf8;--sf:#fff;--sf2:#f2f2ee;--tx:#16171b;--mt:#6d717c;--bd:#e5e5e0;--pr:#0c831f;--pr2:#096b19;--ok:#17803d;--hot:#c2410c;
 position:absolute;inset:0;background:var(--bg);color:var(--tx);font:14px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
.app.dark{--bg:#0f1013;--sf:#16181d;--sf2:#1d2027;--tx:#ececef;--mt:#8b8f9b;--bd:#272a32;--pr:#34c759;--pr2:#34c759;--ok:#4ade80;--hot:#fb923c}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none}
header{display:flex;align-items:center;gap:14px;padding:0 20px;height:56px;flex:none;background:var(--sf);border-bottom:1px solid var(--bd);position:relative}
.logo{font-weight:700;font-size:15px;letter-spacing:-.2px;display:flex;align-items:center;gap:9px;white-space:nowrap}
.logo:before{content:"";width:10px;height:10px;background:var(--pr);border-radius:2px}
.logo small{font-weight:500;color:var(--mt);font-size:12px;margin-left:2px}
.demo{font-size:11px;font-weight:600;color:var(--hot);border:1px solid currentColor;border-radius:4px;padding:0 6px}
.search{flex:1;max-width:460px;min-width:140px}
.search input{width:100%;height:36px;border:1px solid var(--bd);border-radius:8px;padding:0 12px;background:var(--bg);outline:0}
.search input:focus,.fld:focus,select:focus{border-color:var(--pr)}
.sp{flex:1}
.hb{height:34px;padding:0 12px;border:1px solid var(--bd);border-radius:8px;background:var(--sf);font-weight:600;font-size:13px}
.hb:hover{background:var(--sf2)}
.prog{position:absolute;left:0;bottom:-1px;height:2px;background:var(--pr);transition:width .3s}
.body{flex:1;display:flex;min-height:0}
aside{width:264px;flex:none;background:var(--sf);border-right:1px solid var(--bd);overflow:auto;padding:20px;display:flex;flex-direction:column;gap:26px}
aside h4{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--mt);margin-bottom:10px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1px solid var(--bd);background:var(--sf);border-radius:6px;padding:3px 10px;font-size:12.5px;white-space:nowrap}
.chip:hover{border-color:var(--mt)}
.chip.on{border-color:var(--pr);color:var(--pr);background:color-mix(in srgb,var(--pr) 8%,var(--sf))}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.fld{width:100%;height:34px;padding:0 10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);outline:0}
input[type=range]{width:100%;accent-color:var(--pr);margin-top:2px}
input[type=checkbox]{accent-color:var(--pr)}
.sw{display:flex;gap:8px;align-items:center;cursor:pointer}
.btn{background:var(--pr);color:#fff;border-radius:8px;height:40px;font-weight:600;width:100%}
.btn:hover{background:var(--pr2)}
.btn.stop{background:var(--tx);color:var(--bg)}
.btn.ghost{background:var(--sf);color:var(--tx);border:1px solid var(--bd);height:36px;font-weight:600;width:auto;padding:0 14px}
.btn.ghost:hover{background:var(--sf2)}
.note{color:var(--mt);font-size:13px;line-height:1.55}
.note b{color:var(--tx);font-weight:600}
main{flex:1;overflow:auto;padding:22px 24px 48px;min-width:0}
.sum{display:flex;gap:6px 22px;flex-wrap:wrap;color:var(--mt);margin-bottom:16px}
.sum b{color:var(--tx);font-weight:600;margin-right:4px}
.tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:18px}
select{height:34px;border:1px solid var(--bd);border-radius:8px;background:var(--sf);padding:0 8px;outline:0;max-width:180px}
.seg{display:inline-flex;border:1px solid var(--bd);border-radius:8px;overflow:hidden;background:var(--sf)}
.seg button{height:32px;padding:0 12px;font-size:13px;font-weight:500}
.seg button.on{background:var(--tx);color:var(--bg)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
.grid.list{grid-template-columns:1fr;gap:10px}
.card{background:var(--sf);border:1px solid var(--bd);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;position:relative}
.card:hover{border-color:var(--mt)}
.card.oos .im,.card.oos .inf{opacity:.5}
.list .card{flex-direction:row}
.list .im{width:92px;height:92px;flex:none;aspect-ratio:auto}
.im{aspect-ratio:1;background:var(--sf2) center/cover no-repeat;position:relative}
.tg{position:absolute;left:8px;top:8px;background:var(--sf);border:1px solid var(--bd);border-radius:4px;font-size:10.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;padding:0 6px}
.fv{position:absolute;top:6px;right:6px;width:28px;height:28px;border-radius:50%;background:var(--sf);border:1px solid var(--bd);font-size:14px;line-height:1;color:var(--mt)}
.fv.on{color:var(--hot);border-color:var(--hot)}
.inf{padding:12px 14px 14px;display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.ti{font-size:13.5px;font-weight:500;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--tx);text-decoration:none}
a.ti:hover{text-decoration:underline}
.ct{font-size:12px;color:var(--mt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pr{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;margin-top:4px}
.pr b{font-size:18px;font-weight:700;letter-spacing:-.3px}
.pr s{color:var(--mt);font-size:12.5px}
.off{color:var(--ok);font-weight:600;font-size:13px}
.off.hot{color:var(--hot)}
.sv{font-size:12px;color:var(--mt)}
.sv i{font-style:normal;color:var(--hot);font-weight:600}
.acts{display:flex;gap:6px;margin-top:auto;padding-top:10px}
.acts button{flex:1;height:30px;border:1px solid var(--bd);border-radius:6px;font-size:12.5px;font-weight:600;background:var(--sf)}
.acts button:hover{background:var(--sf2)}
.acts .add.in{border-color:var(--pr);color:var(--pr)}
.acts .hide{flex:none;width:54px;color:var(--mt);font-weight:500}
.empty{color:var(--mt);padding:72px 20px;text-align:center}
.empty b{display:block;color:var(--tx);font-size:16px;font-weight:600;margin-bottom:4px}
.drawer{position:absolute;top:0;right:0;bottom:0;width:min(400px,100%);background:var(--sf);border-left:1px solid var(--bd);display:flex;flex-direction:column;transform:translateX(100%);transition:transform .2s;z-index:5}
.drawer.open{transform:none;box-shadow:-12px 0 32px rgba(0,0,0,.12)}
.dl{flex:1;overflow:auto;padding:8px 20px}
.li{display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--bd)}
.li img{width:44px;height:44px;border-radius:6px;object-fit:cover;background:var(--sf2)}
.li div{flex:1;min-width:0;font-size:13px}.li .ti{-webkit-line-clamp:1}
.li s{color:var(--mt);font-size:12px;margin-left:4px}
.qty{display:flex;align-items:center;gap:8px}.qty button{width:26px;height:26px;border-radius:6px;border:1px solid var(--bd)}
.df{padding:16px 20px;border-top:1px solid var(--bd);display:flex;flex-direction:column;gap:10px}
.df .tot{font-size:20px;font-weight:700;letter-spacing:-.4px}
.toast{position:absolute;left:50%;bottom:24px;transform:translateX(-50%) translateY(70px);background:var(--tx);color:var(--bg);padding:10px 16px;border-radius:8px;opacity:0;transition:.2s;pointer-events:none;z-index:9;max-width:90%;font-weight:500}
.toast.on{transform:translateX(-50%);opacity:1}
.menu-btn{display:none}
@media(max-width:820px){
 aside{position:absolute;z-index:4;top:0;bottom:0;left:0;transform:translateX(-100%);transition:transform .2s;width:min(300px,88%)}
 aside.open{transform:none;box-shadow:12px 0 32px rgba(0,0,0,.12)}.menu-btn{display:inline-block}
 header{padding:0 12px;gap:8px}.logo small{display:none}.search{min-width:0}
 main{padding:16px 12px 40px}.grid{grid-template-columns:repeat(2,1fr);gap:10px}
}
kbd{border:1px solid var(--bd);border-radius:4px;padding:0 5px;font-size:11px}
`;
  root.innerHTML = '<style>' + CSS + '</style><div class="app" id="app"></div>';
  const app = root.getElementById('app');

  let sideOpen = false;
  const groupChip = g => `<button class="chip ${store.groups.includes(g.id) ? 'on' : ''}" data-act="grp" data-id="${g.id}">${esc(g.name)}</button>`;
  function scanUI() {
    return `<div><h4>Categories</h4><div class="chips">${GROUPS.map(groupChip).join('')}</div>
  <div class="row" style="margin-top:10px;justify-content:flex-start"><button class="chip" data-act="all">All</button><button class="chip" data-act="none">None</button></div></div>
 <div><h4>Scan</h4>
  ${P.locUI(store, esc)}
  <label class="row" style="margin-top:8px"><span>Pages per category</span><b>${store.depth}</b></label><input type="range" min="1" max="5" value="${store.depth}" data-in="depth"></div>
 ${S.scanning ? '<button class="btn stop" data-act="stop">Stop scan</button>' : '<button class="btn" data-act="scan">Scan deals</button>'}`;
  }
  function sidebar() {
    return `<aside class="${sideOpen ? 'open' : ''}">
 ${typeof captureUI === 'function' && !DEMO ? captureUI() : scanUI()}
 <div><h4>Filters</h4>
  <label class="row"><span>Min discount</span><b>${store.minDisc}%</b></label><input type="range" min="0" max="90" step="5" value="${store.minDisc}" data-in="minDisc">
  <label class="row" style="margin-top:12px"><span>Max price</span><b>${store.maxPrice ? $inr(store.maxPrice) : 'Any'}</b></label><input type="range" min="0" max="2000" step="50" value="${store.maxPrice}" data-in="maxPrice">
  <label class="sw" style="margin-top:14px"><input type="checkbox" data-in="stockOnly" ${store.stockOnly ? 'checked' : ''}> In stock only</label>
  <label class="sw" style="margin-top:8px"><input type="checkbox" data-in="favOnly" ${S.favOnly ? 'checked' : ''}> Saved only</label>
  <label class="sw" style="margin-top:8px"><input type="checkbox" data-in="newOnly" ${S.newOnly ? 'checked' : ''}> New or price dropped</label></div>
 <div><h4>Data</h4><div class="chips"><button class="chip" data-act="csv">Export CSV</button><button class="chip" data-act="copyall">Copy top 20</button><button class="chip" data-act="unhide">Unhide (${store.hidden.length})</button></div>
  <p class="note" style="margin-top:12px"><kbd>/</kbd> search &nbsp;<kbd>S</kbd> scan &nbsp;<kbd>Esc</kbd> close</p></div>
</aside>`;
  }
  function card(p, fav, qtyMap) {
    const inList = qtyMap[p.id];
    return `<article class="card ${p.inStock ? '' : 'oos'}">
 <div class="im" style="background-image:url('${esc(String(p.img).replace(/'/g, '%27'))}')">
  ${p.isNew ? '<span class="tg">New</span>' : p.was ? '<span class="tg">Price drop</span>' : ''}
  <button class="fv ${fav ? 'on' : ''}" data-act="fav" data-id="${esc(p.id)}" title="Save">${fav ? '♥' : '♡'}</button></div>
 <div class="inf"><a class="ti" ${p.url && p.url !== '#demo' ? `href="${esc(p.url)}" target="_blank" rel="noopener"` : ''}>${esc(p.title)}</a>
  <div class="ct">${esc(p.cat)}</div>
  <div class="pr"><b>${$inr(p.price)}</b><s>${$inr(p.mrp)}</s><span class="off ${p.disc >= 60 ? 'hot' : ''}">${p.disc}% off</span></div>
  <div class="sv">You save ${$inr(p.save)}${p.inStock ? '' : ' · <i>Out of stock</i>'}${p.was ? ' · was ' + $inr(p.was) : ''}</div>
  <div class="acts"><button class="add ${inList ? 'in' : ''}" data-act="add" data-id="${esc(p.id)}">${inList ? 'In list · ' + inList : 'Add to list'}</button><button class="hide" data-act="hide" data-id="${esc(p.id)}">Hide</button></div></div></article>`;
  }
  function mainView() {
    const list = filtered();
    const cats = [...new Set([...S.products.values()].map(p => p.cat.split(' › ')[0]))];
    const brands = Object.entries([...S.products.values()].reduce((m, p) => (m[p.brand] = (m[p.brand] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 40);
    const avg = list.length ? Math.round(list.reduce((s, p) => s + p.disc, 0) / list.length) : 0;
    const best = list.reduce((m, p) => p.save > m ? p.save : m, 0);
    const fav = new Set(store.favs);
    return `<main id="main">
 <div class="sum"><span><b>${list.length}</b>of ${S.products.size} products</span><span><b>${avg}%</b>average discount</span><span><b>${$inr(best)}</b>biggest saving</span><span>${S.scanning ? `Scanning ${S.done} of ${S.total}` : store.lastScan ? 'Updated ' + new Date(store.lastScan).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not scanned yet'}</span></div>
 <div class="tools">
  <select data-in="sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${store.sort === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
  <select data-in="cat"><option value="">All categories</option>${cats.map(c => `<option ${S.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
  <select data-in="brand"><option value="">All brands</option>${brands.map(([b, n]) => `<option value="${esc(b)}" ${S.brand === b ? 'selected' : ''}>${esc(b)} (${n})</option>`).join('')}</select>
  <span class="sp"></span>
  <div class="seg"><button class="${store.view === 'grid' ? 'on' : ''}" data-act="view" data-v="grid">Grid</button><button class="${store.view === 'list' ? 'on' : ''}" data-act="view" data-v="list">List</button></div>
 </div>
 ${list.length ? `<div class="grid ${store.view}">${list.slice(0, S.shown).map(p => card(p, fav.has(p.id), store.list)).join('')}</div>
   ${list.length > S.shown ? `<div style="text-align:center;margin-top:22px"><button class="btn ghost" data-act="more">Show more (${list.length - S.shown} left)</button></div>` : ''}`
        : `<div class="empty"><b>${S.scanning ? 'Looking for deals' : S.products.size ? 'Nothing matches these filters' : 'No deals yet'}</b>${S.scanning ? 'Results appear here as they come in.' : S.products.size ? 'Try lowering the minimum discount.' : 'Choose categories on the left and start a scan.'}</div>`}
</main>`;
  }
  function drawer() {
    const items = Object.entries(store.list).map(([id, q]) => [S.products.get(id) || store._cache && store._cache[id], q]).filter(x => x[0]);
    const tot = items.reduce((s, [p, q]) => s + p.price * q, 0), mrp = items.reduce((s, [p, q]) => s + p.mrp * q, 0);
    return `<div class="drawer ${S.panel ? 'open' : ''}"><header><b style="flex:1;font-size:15px">Shopping list</b><button class="hb" data-act="clearlist">Clear</button><button class="hb" data-act="closepanel">Close</button></header>
 <div class="dl">${items.length ? items.map(([p, q]) => `<div class="li"><img src="${esc(p.img)}" alt=""><div><a class="ti">${esc(p.title)}</a><b>${$inr(p.price * q)}</b><s>${$inr(p.mrp * q)}</s></div><div class="qty"><button data-act="dec" data-id="${esc(p.id)}">−</button><b>${q}</b><button data-act="inc" data-id="${esc(p.id)}">+</button></div></div>`).join('') : '<div class="empty"><b>Your list is empty</b>Use “Add to list” on any product.</div>'}</div>
 <div class="df"><div class="row"><span class="note">Total</span><span class="tot">${$inr(tot)}</span></div><div class="row"><span class="note">You save</span><b style="color:var(--ok)">${$inr(mrp - tot)}</b></div>
 <div class="row" style="gap:10px"><button class="btn ghost" style="flex:1" data-act="copylist">Copy list</button><button class="btn" style="flex:1;height:36px" data-act="openlinks">Open all</button></div></div></div>`;
  }
  function render() {
    const dark = store.theme === 'dark' || (store.theme === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches);
    const keepScroll = (root.getElementById('main') || {}).scrollTop || 0;
    const sideScroll = (root.querySelector('aside') || {}).scrollTop || 0;
    const focused = root.activeElement && root.activeElement.dataset ? root.activeElement.dataset.in : null;
    const count = Object.values(store.list).reduce((a, b) => a + b, 0);
    const pct = S.total ? Math.round(S.done / S.total * 100) : 0;
    app.className = 'app' + (dark ? ' dark' : '');
    app.innerHTML = `<header><button class="hb menu-btn" data-act="side">Menu</button><div class="logo">PriceDrop Hunter<small>${esc(PLATFORM)}</small>${DEMO ? '<span class="demo">Demo data</span>' : ''}</div>
 <div class="search"><input data-in="q" placeholder="Search products or brands" value="${esc(S.q)}"></div><span class="sp"></span>
 <button class="hb" data-act="theme">${dark ? 'Light' : 'Dark'}</button><button class="hb" data-act="panel">List${count ? ' · ' + count : ''}</button><button class="hb" data-act="close">Close</button>${S.scanning ? `<div class="prog" style="width:${pct}%"></div>` : ''}</header>
 <div class="body">${sidebar()}${mainView()}</div>${drawer()}<div class="toast" id="toast"></div>`;
    const m = root.getElementById('main'); if (m) m.scrollTop = keepScroll;
    const a = root.querySelector('aside'); if (a) a.scrollTop = sideScroll;
    if (focused === 'q') { const i = root.querySelector('[data-in=q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  let rq = 0;
  const scheduleRender = () => { if (rq) return; rq = setTimeout(() => { rq = 0; render(); }, 250); };
  let tt;
  function toast(msg) {
    const t = root.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 3200);
  }
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg || 'Copied'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(msg || 'Copied'); }
  }
  function listText() {
    const lines = Object.entries(store.list).map(([id, q]) => { const p = S.products.get(id) || (store._cache && store._cache[id]); return p ? `- ${p.title} x${q}: ${$inr(p.price * q)}${p.url && p.url !== '#demo' ? '\n  ' + p.url : ''}` : null; }).filter(Boolean);
    return lines.join('\n');
  }
  // Add products from any source (scan, passive capture) with price-history flags.
  function ingest(items) {
    let fresh = 0;
    for (const p of items) {
      if (!allowed(p) || S.products.has(p.id)) continue;
      const prev = store.prices[p.id];
      p.isNew = prev == null; p.was = prev != null && prev > p.price ? prev : 0;
      S.products.set(p.id, p); fresh++;
    }
    return fresh;
  }

  // ───────────────────────── Events ─────────────────────────
  const reFilter = debounce(() => { S.shown = 60; render(); }, 150);
  root.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.in; if (!k) return;
    if (k === 'q') { S.q = e.target.value; reFilter(); return; }
    if (P.locInput(k, e.target.value)) return;
    if (k === 'depth' || k === 'minDisc' || k === 'maxPrice') { store[k] = +e.target.value; save(); S.shown = 60; render(); return; }
  });
  root.addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.in; if (!k) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'stockOnly') { store.stockOnly = v; save(); }
    else if (k === 'sort') { store.sort = v; save(); }
    else if (k === 'favOnly') S.favOnly = v; else if (k === 'newOnly') S.newOnly = v;
    else if (k === 'cat') S.cat = v; else if (k === 'brand') S.brand = v;
    else return;
    S.shown = 60; render();
  });
  root.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act, id = el.dataset.id;
    store._cache = store._cache || {};
    switch (a) {
      case 'close': api.hide(); break;
      case 'theme': store.theme = app.classList.contains('dark') ? 'light' : 'dark'; save(); render(); break;
      case 'side': sideOpen = !sideOpen; render(); break;
      case 'panel': S.panel = !S.panel; render(); break;
      case 'closepanel': S.panel = false; render(); break;
      case 'grp': store.groups = store.groups.includes(id) ? store.groups.filter(x => x !== id) : store.groups.concat(id); save(); render(); break;
      case 'all': store.groups = GROUPS.map(g => g.id); save(); render(); break;
      case 'none': store.groups = []; save(); render(); break;
      case 'scan': sideOpen = false; scan(); break;
      case 'stop': S.ctl.stop = true; toast('Stopping…'); break;
      case 'autoscroll': if (typeof autoScroll === 'function') autoScroll(); break;
      case 'view': store.view = el.dataset.v; save(); render(); break;
      case 'more': S.shown += 60; render(); break;
      case 'fav': store.favs = store.favs.includes(id) ? store.favs.filter(x => x !== id) : store.favs.concat(id); save(); render(); break;
      case 'hide': store.hidden.push(id); save(); render(); toast('Hidden — undo via Data › Unhide'); break;
      case 'unhide': store.hidden = []; save(); render(); break;
      case 'add': store.list[id] = (store.list[id] || 0) + 1; { const p = S.products.get(id); if (p) store._cache[id] = p; } save(); render(); break;
      case 'inc': store.list[id]++; save(); render(); break;
      case 'dec': if (--store.list[id] <= 0) delete store.list[id]; save(); render(); break;
      case 'clearlist': store.list = {}; save(); render(); break;
      case 'copylist': copy(listText() || 'Empty list', 'List copied'); break;
      case 'openlinks': Object.keys(store.list).map(i => S.products.get(i)).filter(p => p && p.url && p.url !== '#demo').forEach(p => window.open(p.url, '_blank', 'noopener')); break;
      case 'copyall': copy(filtered().slice(0, 20).map(p => `${p.disc}% off · ${p.title} · ${$inr(p.price)} (MRP ${$inr(p.mrp)})${p.url && p.url !== '#demo' ? '\n' + p.url : ''}`).join('\n'), 'Top 20 deals copied'); break;
      case 'csv': {
        const rows = [['Title', 'Brand', 'Category', 'Price', 'MRP', 'Discount %', 'Saving', 'In stock', 'URL']].concat(filtered().map(p => [p.title, p.brand, p.cat, p.price, p.mrp, p.disc, p.save, p.inStock, p.url]));
        const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
        const a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a2.download = 'blinkit-deals.csv'; a2.click(); toast('CSV downloaded'); break;
      }
    }
  });
  document.addEventListener('keydown', e => {
    if (host.style.display === 'none') return;
    const typing = root.activeElement && /INPUT|SELECT/.test(root.activeElement.tagName);
    if (e.key === 'Escape') { if (S.panel) { S.panel = false; render(); } else if (typing) root.activeElement.blur(); else api.hide(); }
    else if (!typing && !e.metaKey && !e.ctrlKey) {
      if (e.key === '/') { e.preventDefault(); const i = root.querySelector('[data-in=q]'); i && i.focus(); }
      else if (e.key.toLowerCase() === 's') S.scanning ? (S.ctl.stop = true) : scan();
    }
    if (!typing || e.key === 'Escape') e.stopPropagation();
  }, true);

  // ───────────────────────── Public API ─────────────────────────
  let prevOverflow = '';
  const api = {
    show() { host.style.display = 'block'; prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'; render(); },
    hide() { host.style.display = 'none'; document.documentElement.style.overflow = prevOverflow; },
    toggle() { host.style.display === 'none' ? api.show() : api.hide(); }
  };
  window.__BDS__ = api;
  document.body.appendChild(host);
  api.show();
  if (typeof P !== 'undefined' && P.install && !DEMO) P.install(ingest);
  if (DEMO && !S.products.size) setTimeout(scan, 300);
})();
