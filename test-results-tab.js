// Regression test for the v2 fetch layer (Blinkit) — run: node test-results-tab.js
// Loads the real parser/fetch functions out of src/deals.js (relative path), feeds
// them the sample layout payload in fixtures/sample-api.json, and checks that every
// fetched item renders as a card. Also covers the self-test, the collection->
// keyword-search fallback, the 50% discount cutoff, retry/backoff, error
// diagnostics, CSV export and unit-price math. No network.
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const src = fs.readFileSync(path.join(ROOT, 'src/deals.js'), 'utf8');
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')); }
}

// ---- stub the browser globals the fetch layer touches at load/call time ----
global.window = { fetch: null };
global.document = { cookie: '', querySelector: () => null, querySelectorAll: () => [], documentElement: { innerHTML: '' } };
global.location = { hostname: 'www.blinkit.com', search: '' };
global.sessionStorage = { getItem: () => null, setItem: () => {} };

// ---- load the fetch layer: everything up to the OFFSITE line, plus a store stub ----
const end = src.indexOf('  // Live data can only be read');
if (end < 0) throw new Error('slice anchor missing in src/deals.js');
const head = src.slice(src.indexOf('(function () {'), end);
const lib = eval(head + `
var store = { brandId: '', lat: '28.61', lon: '77.20', groups: [] };
return { extract, normalise, price, txt, guessBrand, classifyFetchError, pageResult, cutoffReached, searchFallbackFor, selfTest, toCSV, fetchPage };
})();`);

// ---- grab unitOf (+ its UNITS table) from the Filtering section ----
function grabFn(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  const j = src.indexOf('{', i);
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const uStart = src.indexOf('const UNITS =');
const unitsSrc = src.slice(uStart, src.indexOf('};', uStart) + 2);
const unitOf = eval('(function () {\n' + unitsSrc + '\n' + grabFn('unitOf') + '\nreturn unitOf; })();');

// ---- grab the results-tab sort (byDisc) the Best-deals row uses ----
const byDiscMatch = src.match(/const byDisc = (\(a, b\) => [^;]+);/);
if (!byDiscMatch) throw new Error('byDisc missing in src/deals.js');
const byDisc = eval(byDiscMatch[1]);

// ---- response stub ----
function resp(o) {
  const status = o.status || 200;
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: h => (h.toLowerCase() === 'content-type' ? (o.ct || 'application/json') : null) },
    json: async () => o.json, text: async () => o.text
  };
}
// Minimal card render, mirroring the UI card(): one <article class="card"> per product.
function renderCards(products) {
  return products.map(p =>
    '<article class="card"><div class="im" style="background-image:url(\'' + p.img + '\')">' +
    '<span class="dc">' + p.disc + '% OFF</span></div><div class="inf"><a class="ti" href="' + p.url + '">' +
    p.title + '</a><div class="pr"><b>₹' + p.price + '</b><s>₹' + p.mrp + '</s></div></div></article>').join('');
}
// One Blinkit layout item with a chosen discount (mrp 200, price derived).
function mkItem(id, disc, oos) {
  const mrp = 200, sell = Math.round(mrp * (1 - disc / 100));
  return { data: { name: { text: 'Test Product ' + id }, normal_price: { text: '₹' + sell }, mrp: { text: '₹' + mrp }, product_id: id, brand_name: { text: 'TestBrand' }, variant: { text: '1 kg' }, image: { url: 'https://example.com/' + id + '.jpg' }, is_sold_out: !!oos } };
}

(async () => {
  console.log('== 1. parser: 70 valid layout items in, 70 renderable products out ==');
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/sample-api.json'), 'utf8'));
  const items = lib.extract(fixture, 'Test');
  check('extract returns 70 items (5 invalid entries skipped)', items.length === 70, 'got ' + items.length);
  const gate = items.filter(p => p.id && p.title && p.price > 0 && p.mrp >= p.price && p.disc >= 0 && p.disc <= 100 && p.url.indexOf('https://blinkit.com/prn/') === 0);
  check('all 70 pass the render gate (id/title/price/mrp/disc/url)', gate.length === 70, 'gated ' + gate.length);
  const cards = renderCards(gate);
  check('70 items render as 70 cards', (cards.match(/<article class="card"/g) || []).length === 70);
  check('out-of-stock items still parse (inStock=false, still renderable)', items.filter(p => !p.inStock).length === 5, 'oos ' + items.filter(p => !p.inStock).length);
  check('discount computed from mrp/price (item 1: 50% off)', items[0].disc === 50, 'got ' + items[0].disc);

  console.log('== 2. built-in self-test (same function the sidebar button runs) ==');
  const st = lib.selfTest();
  st.checks.forEach(c => check('self-test: ' + c.name, c.pass === true));
  check('self-test overall ok', st.ok === true);

  console.log('== 3. discount cutoff + fallback decision (pure) ==');
  check('cutoff: tail all below 50% stops paging', lib.cutoffReached([{ disc: 40 }, { disc: 30 }, { disc: 45 }]) === true);
  check('cutoff: 60% in tail keeps paging', lib.cutoffReached([{ disc: 60 }, { disc: 30 }]) === false);
  check('cutoff: all sold out stops paging', lib.cutoffReached([{ disc: 80, inStock: false }, { disc: 70, inStock: false }]) === true);
  check('cutoff: empty page stops paging', lib.cutoffReached([]) === true);
  const fb = lib.searchFallbackFor({ kind: 'list', name: 'Atta', g: {} });
  check('fallback: list job -> search job for its own name', !!fb && fb.kind === 'search' && fb.q === 'Atta');
  check('fallback: search jobs do not fall back again', lib.searchFallbackFor({ kind: 'search', name: 'Atta' }) === null);

  console.log('== 4. error diagnostics (blank grid must say why) ==');
  check('403 classified', lib.classifyFetchError(403).indexOf('403') !== -1);
  check('429 classified', lib.classifyFetchError(429).indexOf('429') !== -1);
  check('500 classified', lib.classifyFetchError(500).indexOf('500') !== -1);

  console.log('== 5. CSV export + unit price ==');
  const csv = lib.toCSV(items.slice(0, 2));
  check('CSV has header + 2 rows', csv.split('\n').length === 3 && csv.indexOf('"Title","Brand","Category"') === 0);
  check('unit price: 10 kg', JSON.stringify(unitOf('Test Atta 10 kg')) === JSON.stringify({ base: 'kg', qty: 10 }));
  check('unit price: 500 g = 0.5 kg', unitOf('Sugar 500 g').qty === 0.5);
  check('unit price: 1 L', unitOf('Milk 1 L').base === 'L');

  console.log('== 6. fetchPage with stubbed fetch: cutoff paging, fallback, retry ==');
  const listJob = { kind: 'list', uuid: 'OTg3NjU0MzIxMjM0NTMzNjk=', gid: '16426', g: { name: 'Atta, Rice & Dal (collection)' }, name: 'Atta' };
  const searchJob = { kind: 'search', q: 'atta', g: { name: 'Grocery & Staples' }, name: 'Atta' };
  // 6a. full page, tail still >= 50% -> more=true.
  const fullPage = { response: { widgets: Array.from({ length: 15 }, (_, i) => mkItem(100 + i, 60)) } };
  global.window.fetch = async () => resp({ json: fullPage });
  let r = await lib.fetchPage(listJob, 1, { stop: false });
  check('full page, tail >= 50%: 15 items, more=true', r.length === 15 && r.more === true, 'len ' + r.length + ' more ' + r.more);
  // 6b. full page, tail below 50% -> more=false (stop paging, don't fetch empty pages).
  const tailLow = { response: { widgets: [...Array.from({ length: 12 }, (_, i) => mkItem(200 + i, 60)), mkItem(212, 40), mkItem(213, 30), mkItem(214, 20)] } };
  global.window.fetch = async () => resp({ json: tailLow });
  r = await lib.fetchPage(listJob, 1, { stop: false });
  check('full page, tail below 50%: 15 items, more=false', r.length === 15 && r.more === false, 'more ' + r.more);
  // 6c. collection returns nothing -> retried once as keyword search for 'Atta'.
  global.window.fetch = async url => (String(url).indexOf('/v1/layout/search') !== -1
    ? resp({ json: { response: { widgets: [mkItem(301, 65), mkItem(302, 55)] } } })
    : resp({ json: { response: { widgets: [] } } }));
  r = await lib.fetchPage(listJob, 1, { stop: false });
  check('empty collection falls back to search: 2 items', r.length === 2, 'len ' + r.length);
  check('fallback items render as cards', (renderCards(r).match(/<article class="card"/g) || []).length === 2);
  // 6d. 429 once, then success -> retry recovers.
  let calls = 0;
  global.window.fetch = async () => { calls++; return calls === 1 ? resp({ status: 429 }) : resp({ json: fullPage }); };
  r = await lib.fetchPage(searchJob, 1, { stop: false });
  check('429 then success: 15 items after retry', r.length === 15 && calls === 2, 'calls ' + calls);
  // 6e. 403 -> error surfaced on the result, not a blank grid.
  global.window.fetch = async () => resp({ status: 403 });
  r = await lib.fetchPage(listJob, 1, { stop: false });
  check('403: 0 items + error message attached', r.length === 0 && /403/.test(r.error || ''), 'error=' + r.error);
  // 6f. no location -> error surfaced.
  global.window.fetch = async () => { throw new Error('fetch should not run without location'); };
  const noLocLib = eval(head + `
var store = { brandId: '', lat: '', lon: '', groups: [] };
return { fetchPage };
})();`);
  r = await noLocLib.fetchPage(listJob, 1, { stop: false });
  check('no lat/lon: 0 items + location error attached', r.length === 0 && /location/i.test(r.error || ''), 'error=' + r.error);

  console.log('== 7. highest-discount fixture: 85-95% off items render, highest first, cutoff not tripped ==');
  const hd = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/sample-high-discount.json'), 'utf8'));
  const hdItems = lib.extract(hd, 'High-discount');
  check('high-discount fixture: all 8 items extracted (none dropped by the parser)', hdItems.length === 8, 'got ' + hdItems.length);
  const byHdId = {}; hdItems.forEach(p => { byHdId[p.id] = p; });
  check('value-keyed prices read .value, disc 95%', byHdId['910003'].price === 50 && byHdId['910003'].disc === 95);
  check('max-only prices read .max, disc 90%', byHdId['910004'].price === 99 && byHdId['910004'].disc === 90);
  check('out-of-stock 80% item still parses (hidden only by the stock filter, not the parser)', byHdId['910007'].disc === 80 && byHdId['910007'].inStock === false);
  check('no MRP stays disc 0 (no discount signal to invent)', byHdId['910008'].disc === 0);
  // Same gate the UI's filtered() applies: in stock + disc >= minDisc 30.
  const hdVisible = hdItems.filter(p => p.inStock && p.disc >= 30).sort(byDisc);
  check('6 of 8 pass the min-discount-30 + in-stock gate', hdVisible.length === 6, 'visible ' + hdVisible.length);
  check('highest discount renders FIRST in the results tab (95% item first)', hdVisible[0].id === '910003', 'first ' + hdVisible[0].id);
  const hdCards = renderCards(hdVisible);
  const firstCard = hdCards.split('<article')[1] || '';
  check('first rendered card is the 95% off item', firstCard.indexOf('95% OFF') !== -1 && firstCard.indexOf('High Discount Value Keyed Price Dal 1 kg') !== -1);
  // A page whose tail is true-90%+ items in odd price shapes must not trip
  // the 50% cutoff: before the fix the tail parsed to disc 0 and paging stopped.
  const tailPage = { response: { widgets: [...Array.from({ length: 12 }, (_, i) => mkItem(920000 + i, 60)),
    { data: { name: { text: 'Cutoff Tail A' }, normal_price: { text: '₹50' }, mrp: { value: 1000 }, product_id: 920100, is_sold_out: false } },
    { data: { name: { text: 'Cutoff Tail B' }, normal_price: { text: '₹99' }, mrp: { max: 999 }, product_id: 920101, is_sold_out: false } },
    { data: { name: { text: 'Cutoff Tail C' }, normal_price: 80, mrp: { value: 1000 }, product_id: 920102, is_sold_out: false } }] } };
  const tailParsed = lib.extract(tailPage, 'Cutoff');
  check('cutoff page: tail parses to its true discounts [95, 90, 92]', tailParsed.slice(-3).map(p => p.disc).join(',') === '95,90,92', 'tail ' + tailParsed.slice(-3).map(p => p.disc).join(','));
  check('cutoff page: cutoff NOT reached, paging continues (more=true)', tailParsed.length === 15 && lib.cutoffReached(tailParsed) === false, 'len ' + tailParsed.length);

  console.log('\n' + (fail ? 'FAIL: ' + fail + ' check(s) failed, ' + pass + ' passed' : 'PASS: all ' + pass + ' checks passed (70 items -> 70 cards)'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
