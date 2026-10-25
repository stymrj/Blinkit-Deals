// Blinkit: keyword search and collection listings, sorted by discount, for your coordinates.
'use strict';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const txt = v => (v && typeof v === 'object' ? v.text : v);

function normalise(o, cat, { price, brandOf }) {
  const d = o.data, ci = (d.atc_action && d.atc_action.add_to_cart && d.atc_action.add_to_cart.cart_item) || {};
  const title = txt(d.name) || ci.display_name || ci.product_name;
  const sell = price(txt(d.normal_price) || ci.price);
  let mrp = price(txt(d.mrp) || ci.mrp);
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
  })(json, 0);
  return out;
}

module.exports = {
  label: 'Blinkit',
  required: ['BLINKIT_LAT', 'BLINKIT_LON'],
  workers: 2,
  sortedByDiscount: true,
  pageSize: 15,
  async fetchPage(job, page, ctx) {
    const { env, fetch, sleep } = ctx;
    const [code] = job.sub, offset = (page - 1) * 15, pi = String(page - 1);
    let url, body;
    if (job.g.uuid) {
      url = 'https://blinkit.com/v1/layout/listing_widgets?collection_uuid=' + encodeURIComponent(job.g.uuid) + '&collection_group_id=' + code + '&sort=discount_desc';
      body = { offset: String(offset), limit: '15', collection_uuid: job.g.uuid, collection_group_id: code, page_index: pi, oos_visibility: true, sort: 'discount_desc' };
    } else {
      url = 'https://blinkit.com/v1/layout/search?q=' + encodeURIComponent(code) + '&search_type=type_to_search&page_index=' + pi + '&offset=' + offset + '&limit=15&oos_visibility=true&sort=discount_desc';
      body = { query: code, q: code, search_query: code, page_index: pi, offset: String(offset), limit: '15', oos_visibility: true, sort: 'discount_desc' };
    }
    await sleep(350 + Math.random() * 450); // Blinkit rate-limits bursts hard
    for (let a = 0; a < 5; a++) {
      const r = await fetch(url, {
        method: 'POST', body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', accept: '*/*', app_client: 'consumer_web', lat: env.BLINKIT_LAT, lon: env.BLINKIT_LON, 'user-agent': UA, origin: 'https://blinkit.com', referer: 'https://blinkit.com/', ...(env.BLINKIT_COOKIE ? { cookie: env.BLINKIT_COOKIE } : {}) }
      });
      if (r.status === 403) throw Object.assign(new Error('Blinkit blocked this machine (HTTP 403). GitHub-hosted runners are often blocked; use a self-hosted runner (see README).'), { blocked: true });
      if (r.status === 429) { await sleep(2500 * (a + 1) + Math.random() * 1000); continue; }
      if (r.status >= 500) { await sleep(2000 * (a + 1)); continue; }
      if (!r.ok) return [];
      return extract(await r.json(), job.g.name + ' › ' + job.sub[1], ctx);
    }
    throw new Error('rate limited');
  }
};
