// Bot platform test (Blinkit) — run: node test/bot-platform.test.js
// Requires bot/platform.js directly and calls fetchPage with a stubbed fetch.
// Covers the full listing body, the 50% discount cutoff, the collection->
// keyword-search fallback, and multi-pincode merging/dedupe. No network.
const path = require('path');
const platform = require(path.join(__dirname, '..', 'bot', 'platform.js'));
// The production price() from bot/core.js (the ctx the bot actually runs
// with) — the test must exercise the real function, not a copy of it.
const { price } = require(path.join(__dirname, '..', 'bot', 'core.js'));
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')); }
}
const brandOf = t => (String(t).trim().split(/\s+/)[0] || '').replace(/[^\w&'-]/g, '');
function resp(o) {
  const status = o.status || 200;
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: h => (h.toLowerCase() === 'content-type' ? (o.ct || 'application/json') : null) },
    json: async () => o.json, text: async () => o.text
  };
}
function mkItem(id, disc) {
  const mrp = 200, sell = Math.round(mrp * (1 - disc / 100));
  return { data: { name: { text: 'Bot Test Product ' + id }, normal_price: { text: '₹' + sell }, mrp: { text: '₹' + mrp }, product_id: id, brand_name: { text: 'TestBrand' }, variant: { text: '1 kg' }, image: { url: 'https://example.com/' + id + '.jpg' }, is_sold_out: false } };
}
const ctx = env => ({ env, fetch: null, sleep: async () => {}, price, brandOf });
const listJob = { g: { name: 'Atta, Rice & Dal (collection)', uuid: 'OTg3NjU0MzIxMjM0NTMzNjk=' }, sub: ['16426', 'Atta'] };
const kwJob = { g: { name: 'Grocery & Staples' }, sub: ['atta', 'Atta'] };

(async () => {
  console.log('== Blinkit bot/platform.js ==');
  // 1. listing job, one location: items parsed, cutoff decides .more.
  let c = ctx({ BLINKIT_LAT: '28.61', BLINKIT_LON: '77.20' });
  c.fetch = async () => resp({ json: { response: { widgets: Array.from({ length: 15 }, (_, i) => mkItem(100 + i, 60)) } } });
  let r = await platform.fetchPage(listJob, 1, c);
  check('listing job: 15 items, more=true (tail still >= 50%)', r.length === 15 && r.more === true, 'len ' + r.length + ' more ' + r.more);
  check('product URL built from slug + id', r[0].url === 'https://blinkit.com/prn/bot-test-product-100/prid/100', r[0].url);
  // 2. multi-pincode: two locations, overlapping ids -> merged, deduped.
  c = ctx({ BLINKIT_LOCATIONS: '28.61,77.20;28.55,77.25' });
  c.fetch = async (url, opts) => {
    const lat = opts.headers.lat;
    const ids = lat === '28.61' ? [1, 2] : [2, 3];
    return resp({ json: { response: { widgets: ids.map(id => mkItem(id, 60)) } } });
  };
  r = await platform.fetchPage(listJob, 1, c);
  check('multi-pincode: 2 locations merge to 3 unique products (id 2 deduped)', r.length === 3, 'len ' + r.length);
  // 3. one location fails (network error), the other still delivers.
  c = ctx({ BLINKIT_LOCATIONS: '28.61,77.20;28.55,77.25' });
  c.fetch = async (url, opts) => {
    if (opts.headers.lat === '28.61') throw new Error('net down');
    return resp({ json: { response: { widgets: [mkItem(9, 70)] } } });
  };
  r = await platform.fetchPage(listJob, 1, c);
  check('failing location skipped, other location delivers 1 item', r.length === 1 && r[0].id === '9', 'len ' + r.length);
  // 4. all locations fail -> throws.
  c = ctx({ BLINKIT_LOCATIONS: '28.61,77.20;28.55,77.25' });
  c.fetch = async () => { throw new Error('net down'); };
  let threw = null;
  try { await platform.fetchPage(listJob, 1, c); } catch (e) { threw = e; }
  check('all locations failing throws', !!threw, threw && threw.message);
  // 5. empty collection -> keyword-search fallback returns items.
  c = ctx({ BLINKIT_LAT: '28.61', BLINKIT_LON: '77.20' });
  c.fetch = async url => (String(url).indexOf('/v1/layout/search') !== -1
    ? resp({ json: { response: { widgets: [mkItem(301, 65), mkItem(302, 55)] } } })
    : resp({ json: { response: { widgets: [] } } }));
  r = await platform.fetchPage(listJob, 1, c);
  check('empty collection falls back to search: 2 items', r.length === 2, 'len ' + r.length);
  // 6. 403 -> blocked error.
  c = ctx({ BLINKIT_LAT: '28.61', BLINKIT_LON: '77.20' });
  c.fetch = async () => resp({ status: 403 });
  threw = null;
  try { await platform.fetchPage(listJob, 1, c); } catch (e) { threw = e; }
  check('403 throws a blocked error', !!threw && threw.blocked === true, threw && threw.message);
  // 7. keyword job uses the search endpoint with discount sort.
  let seenUrl = '';
  c = ctx({ BLINKIT_LAT: '28.61', BLINKIT_LON: '77.20' });
  c.fetch = async url => { seenUrl = String(url); return resp({ json: { response: { widgets: [mkItem(401, 60)] } } }); };
  r = await platform.fetchPage(kwJob, 1, c);
  check('keyword job uses /v1/layout/search with sort=discount_desc', seenUrl.indexOf('/v1/layout/search?q=atta') !== -1 && seenUrl.indexOf('sort=discount_desc') !== -1, seenUrl);

  // 8. highest-discount edge shapes: value-/max-keyed prices must parse, and
  // a page whose tail is true-90%+ items in odd shapes must not trip the
  // 50% cutoff (more=true, so the bot keeps paging).
  c = ctx({ BLINKIT_LAT: '28.61', BLINKIT_LON: '77.20' });
  c.fetch = async () => resp({ json: { response: { widgets: [
    { data: { name: { text: 'Bot Value Price Dal' }, normal_price: { value: 50 }, mrp: { value: 1000 }, product_id: 910003, is_sold_out: false } },
    { data: { name: { text: 'Bot Max Price Oil' }, normal_price: { max: 99 }, mrp: { max: 999 }, product_id: 910004, is_sold_out: false } }
  ] } } });
  r = await platform.fetchPage(listJob, 1, c);
  check('bot edge shapes: both items extracted with true discounts', r.length === 2 && (r.find(p => p.id === '910003') || {}).disc === 95 && (r.find(p => p.id === '910004') || {}).disc === 90, 'len ' + r.length);
  const tailPage = { response: { widgets: [...Array.from({ length: 12 }, (_, i) => mkItem(920000 + i, 60)),
    { data: { name: { text: 'Bot Cutoff Tail A' }, normal_price: { text: '₹50' }, mrp: { value: 1000 }, product_id: 920100, is_sold_out: false } },
    { data: { name: { text: 'Bot Cutoff Tail B' }, normal_price: { text: '₹99' }, mrp: { max: 999 }, product_id: 920101, is_sold_out: false } },
    { data: { name: { text: 'Bot Cutoff Tail C' }, normal_price: 80, mrp: { value: 1000 }, product_id: 920102, is_sold_out: false } }] } };
  c.fetch = async () => resp({ json: tailPage });
  r = await platform.fetchPage(listJob, 1, c);
  check('bot cutoff page: 15 items, tail true discounts, more=true', r.length === 15 && r.more === true && r.slice(-3).map(p => p.disc).join(',') === '95,90,92', 'len ' + r.length + ' more ' + r.more);

  console.log('\n' + (fail ? 'FAIL: ' + fail + ' check(s) failed, ' + pass + ' passed' : 'PASS: all ' + pass + ' checks passed'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
