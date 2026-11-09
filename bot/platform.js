// Blinkit: keyword search and collection listings, sorted by discount, for your coordinates.
'use strict';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const txt = v => (v && typeof v === 'object' ? v.text : v);

function normalise(o, cat, { price, brandOf }) {
  const d = o.data, ci = (d.atc_action && d.atc_action.add_to_cart && d.atc_action.add_to_cart.cart_item) || {};
  const title = txt(d.name) || ci.display_name || ci.product_name;
  // Price fields go to price() directly, not through txt(): txt() returns
  // undefined for objects without a .text key, which dropped value-/max-
  // keyed prices entirely. price() (bot/core.js) reads amount/value/max/
  // text/min itself.
  const sell = price(d.normal_price) || price(ci.price);
  let mrp = price(d.mrp) || price(ci.mrp);
  if (!title || !sell) return null;
  if (mrp < sell) mrp = sell;
  const unit = txt(d.variant) || ci.unit || '';
  const pid = d.product_id || ci.product_id || title + '|' + sell;
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { id: String(pid), title: String(title) + (unit ? ' · ' + unit : ''), brand: String(txt(d.brand_name) || d.brand || ci.brand || brandOf(title)), price: sell, mrp, disc: mrp > sell ? Math.round((mrp - sell) / mrp * 100) : 0, url: 'https://blinkit.com/prn/' + slug + '/prid/' + pid, inStock: !(d.is_sold_out === true || ci.inventory === 0 || d.inventory === 0), cat };
}
function extract(json, cat, ctx) {
  const out = [], seen = new Set();
  (function walk(o, d) {
    if (!o || typeof o !== 'object' || d > 16) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    if (o.data && typeof o.data === 'object' && (o.data.name || o.data.normal_price || o.data.atc_action)) {
      const p = normalise(o, cat, ctx);
      if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); return; }
    }
    for (const k in o) walk(o[k], d + 1);
  })(json && json.response ? json.response : json, 0);
  return out;
}

// Pages come back sorted by discount: stop when a page is short or its tail has
// fallen below the 50% cutoff instead of fetching empty pages.
function cutoffReached(items) {
  if (!items.length) return true;
  if (items.every(p => p.inStock === false)) return true;
  return items.slice(-3).every(p => p.disc < 50);
}

// Delivery points to scan: BLINKIT_LOCATIONS="lat,lon;lat,lon" scans each pincode
// area and merges the results (deduped by product id). Falls back to the single
// BLINKIT_LAT / BLINKIT_LON pair.
function locationsOf(env) {
  const list = String(env.BLINKIT_LOCATIONS || '').split(';').map(x => x.trim()).filter(Boolean)
    .map(x => { const [lat, lon] = x.split(',').map(y => y.trim()); return { lat, lon }; })
    .filter(l => l.lat && l.lon);
  if (list.length) return list;
  return [{ lat: env.BLINKIT_LAT, lon: env.BLINKIT_LON }];
}

async function fetchOne(job, page, lat, lon, ctx) {
  const { env, fetch, sleep } = ctx;
  const [code] = job.sub, offset = (page - 1) * 15, pi = String(page - 1);
  let url, body;
  if (job.g.uuid) {
    url = 'https://blinkit.com/v1/layout/listing_widgets?collection_uuid=' + encodeURIComponent(job.g.uuid) + '&collection_group_id=' + code + '&sort=discount_desc';
    body = { offset: String(offset), limit: '15', collection_filters: '[]', collection_group_id: code, collection_properties: JSON.stringify([{ id: 4179, name: 'NEXT_PRODUCT_RECOMMENDATION', value: 'true' }]), collection_uuid: job.g.uuid, exclude_combos: 'false', last_snippet_type: 'product_card_snippet_type_2', last_widget_type: 'product_container', oos_visibility: 'true', page_index: pi, products: '[]', total_entities_processed: String(offset), total_pagination_items: String(15 * 200), applied_filters: null, sort: 'discount_desc' };
  } else {
    url = 'https://blinkit.com/v1/layout/search?q=' + encodeURIComponent(code) + '&search_type=type_to_search&page_index=' + pi + '&offset=' + offset + '&limit=15&oos_visibility=true&sort=discount_desc';
    body = { query: code, q: code, search_query: code, page_index: page - 1, offset, limit: 15, oos_visibility: 'true', sort: 'discount_desc' };
  }
  await sleep(350 + Math.random() * 450); // Blinkit rate-limits bursts hard
  let fellBack = false;
  for (let a = 0; a < 5; a++) {
    const r = await fetch(url, {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', accept: '*/*', app_client: 'consumer_web', lat, lon, 'user-agent': UA, origin: 'https://blinkit.com', referer: 'https://blinkit.com/', ...(env.BLINKIT_COOKIE ? { cookie: env.BLINKIT_COOKIE } : {}) }
    });
    if (r.status === 403) throw Object.assign(new Error('Blinkit blocked this machine (HTTP 403). GitHub-hosted runners are often blocked; use a self-hosted runner (see README).'), { blocked: true });
    if (r.status === 429) { await sleep(2500 * (a + 1) + Math.random() * 1000); continue; }
    if (r.status >= 500) { await sleep(2000 * (a + 1)); continue; }
    if (!r.ok) return [];
    const items = extract(await r.json(), job.g.name + ' › ' + job.sub[1], ctx);
    // A collection that returns nothing is retried once as a keyword search for
    // the subcategory name, instead of reporting an empty aisle.
    if (!items.length && !fellBack && job.g.uuid) {
      fellBack = true;
      url = 'https://blinkit.com/v1/layout/search?q=' + encodeURIComponent(job.sub[1]) + '&search_type=type_to_search&page_index=0&offset=0&limit=15&oos_visibility=true&sort=discount_desc';
      body = { query: job.sub[1], q: job.sub[1], search_query: job.sub[1], page_index: 0, offset: 0, limit: 15, oos_visibility: 'true', sort: 'discount_desc' };
      continue;
    }
    items.more = items.length >= 15 && !cutoffReached(items);
    return items;
  }
  throw new Error('rate limited');
}

module.exports = {
  label: 'Blinkit',
  required: ['BLINKIT_LAT', 'BLINKIT_LON'],
  workers: 2,
  sortedByDiscount: true,
  pageSize: 15,
  async fetchPage(job, page, ctx) {
    // Multi-pincode: scan every configured location and merge, deduped by id.
    // A location that fails (rate limit, block) is skipped; the job only fails
    // when every location fails.
    const merged = [], seen = new Set();
    let anyMore = false, okCount = 0, lastErr = null;
    for (const { lat, lon } of locationsOf(ctx.env)) {
      let items;
      try { items = await fetchOne(job, page, lat, lon, ctx); }
      catch (e) { if (e.blocked) throw e; lastErr = e; continue; }
      okCount++;
      for (const p of items) if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
      if (items.more) anyMore = true;
    }
    if (!okCount) throw lastErr || new Error('all locations failed');
    merged.more = anyMore;
    return merged;
  }
};
