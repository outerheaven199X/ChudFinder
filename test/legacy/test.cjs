/* Run: NODE_PATH=<dir with jsdom>/node_modules node test/test.js */
'use strict';
// Legacy 1.2.0 tests, run against the built extension in dist/src (npm run build first).
const DIST = require('path').join(__dirname, '../../dist/src');
const load = f => { require('vm').runInThisContext(require('fs').readFileSync(require('path').join(DIST, f), 'utf8'), { filename: f }); return { 'countries.js': globalThis.CFCountries, 'lib.js': globalThis.CFLib, 'settings-schema.js': globalThis.CFSettings }[f]; };
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const C = load('countries.js');
const L = load('lib.js');
const F = require('./fixtures.cjs');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); process.exitCode = 1; }
}

(async () => {
  const dom = new JSDOM(F.TWEET_HTML);
  const doc = dom.window.document;

  await t('extracts main author from profile link and quoted author from @text', () => {
    const authors = L.extractAuthors(doc.querySelector('article'));
    assert.deepStrictEqual(authors.map(a => a.handle), ['jack', 'quoted_person']);
  });

  await t('rejects reserved paths and bad handles', () => {
    assert.strictEqual(L.cleanHandle('home'), null);
    assert.strictEqual(L.cleanHandle('@way_too_long_handle_x'), null);
    assert.strictEqual(L.cleanHandle('@ok_1'), 'ok_1');
  });

  await t('parseAbout reads based-in, VPN flag and source', () => {
    const r = L.parseAbout(F.about('jack', { account_based_in: 'United States', location_accurate: true, source: 'United States App Store' }), 'JACK');
    assert.deepStrictEqual(r, { basedIn: 'United States', accurate: true, source: 'United States App Store', notFound: false });
    assert.strictEqual(L.parseAbout({ data: {} }, 'x').notFound, true);
    assert.throws(() => L.parseAbout(F.about('other', {}), 'jack'));
  });

  await t('classifySource handles iOS / Android / Web', () => {
    assert.deepStrictEqual(L.classifySource('Japan App Store').country, 'Japan');
    assert.deepStrictEqual(L.classifySource('Russian Federation Android App').country, 'Russian Federation');
    assert.strictEqual(L.classifySource('Web').platform, 'Web');
  });

  await t('stated location parsing', () => {
    assert.strictEqual(L.countryFromStatedLocation('Austin, TX'), 'US');
    assert.strictEqual(L.countryFromStatedLocation('Lagos, Nigeria'), 'NG');
    assert.strictEqual(L.countryFromStatedLocation('Texas'), 'US');
    assert.strictEqual(L.countryFromStatedLocation('the internet'), null);
  });

  await t('renders a neutral country badge', () => {
    const el = L.renderBadge(doc, { basedIn: 'Japan', accurate: true, source: 'Japan App Store' }, {}, '', 'jack');
    assert.strictEqual(el.querySelector('.cf-flag').textContent, '\u{1F1EF}\u{1F1F5}');
    assert.strictEqual(el.querySelector('.cf-name').textContent, 'Japan');
    assert.ok(!el.classList.contains('cf-warn') && !el.classList.contains('cf-highlight') && !el.classList.contains('cf-outside'));
  });

  await t('unknown -> grey ? badge', () => {
    const el = L.renderBadge(doc, { basedIn: null, notFound: true }, {}, '', 'x');
    assert.ok(el.classList.contains('cf-unknown'));
    assert.strictEqual(el.textContent, '?');
  });

  await t('VPN warning when location_accurate is false, suppressible', () => {
    const info = { basedIn: 'Germany', accurate: false };
    assert.ok(L.renderBadge(doc, info, {}, '').classList.contains('cf-warn'));
    assert.ok(!L.renderBadge(doc, info, { vpnWarnings: false }, '').classList.contains('cf-warn'));
  });

  await t('mismatch warning: stated location and app-store region', () => {
    const a = L.renderBadge(doc, { basedIn: 'Nigeria', accurate: true }, {}, 'Dallas, TX');
    assert.ok(a.classList.contains('cf-warn') && /Dallas, TX/.test(a.title));
    const b = L.renderBadge(doc, { basedIn: 'United States', accurate: true, source: 'India Android App' }, {}, '');
    assert.ok(b.classList.contains('cf-warn'));
    const c = L.renderBadge(doc, { basedIn: 'United States', accurate: true, source: 'United States App Store' }, {}, 'NYC, NY');
    assert.ok(!c.classList.contains('cf-warn'));
  });

  await t('highlight is purely user-chosen; topic mode outlines outside home country', () => {
    const info = { basedIn: 'Canada', accurate: true };
    assert.ok(!L.renderBadge(doc, info, {}, '').classList.contains('cf-highlight'), 'nothing highlighted by default');
    assert.deepStrictEqual(L.DEFAULT_SETTINGS.highlightCountries, []);
    assert.ok(L.renderBadge(doc, info, { highlightCountries: ['CA'] }, '').classList.contains('cf-highlight'));
    assert.ok(L.renderBadge(doc, info, { topicMode: true, homeCountry: 'US' }, '').classList.contains('cf-outside'));
    assert.ok(!L.renderBadge(doc, { basedIn: 'United States' }, { topicMode: true, homeCountry: 'US' }, '').classList.contains('cf-outside'));
  });

  await t('regions get a globe, not a flag', () => {
    const el = L.renderBadge(doc, { basedIn: 'South Asia' }, {}, '');
    assert.strictEqual(el.querySelector('.cf-flag').textContent, '\u{1F310}');
  });

  await t('every country has a valid flag', () => {
    for (const c of C.COUNTRIES) assert.ok(C.flagEmoji(c.code).length === 4, c.code);
  });


  await t('page.js: captures bearer, query id and self-reported locations', async () => {
    const d = new JSDOM('', { url: 'https://x.com/home', runScripts: 'outside-only' });
    const w = d.window; const msgs = [];
    w.addEventListener('message', e => { if (e.data && e.data.__chudFinder) msgs.push(e.data); });
    const timeline = { data: { home: { instructions: [{ entries: [{ content: { itemContent: { tweet_results: { result: {
      core: { user_results: { result: { __typename: 'User', core: { screen_name: 'Jack' }, location: { location: 'San Francisco, CA' } } } } } } } } }] }] } } };
    w.fetch = async () => ({ headers: new w.Headers({ 'content-type': 'application/json' }), clone() { return { json: async () => timeline }; } });
    w.eval(fs.readFileSync(path.join(DIST, 'page.js'), 'utf8'));
    await w.fetch('https://x.com/i/api/graphql/abcdefghijklmnop12/HomeTimeline?x=1', { headers: { authorization: 'Bearer TESTTOKEN' } });
    await w.fetch('https://x.com/i/api/graphql/NEWQUERYID12345678/AboutAccountQuery?variables=%7B%7D', { headers: {} });
    await new Promise(r => setTimeout(r, 50));
    assert.ok(msgs.some(m => m.type === 'auth' && m.payload === 'Bearer TESTTOKEN'));
    assert.ok(msgs.some(m => m.type === 'queryId' && m.payload === 'NEWQUERYID12345678'));
    assert.ok(msgs.some(m => m.type === 'locations' && m.payload.jack === 'San Francisco, CA'));
    w.close();
  });

  // ---- integration: real content.js in jsdom with mocked chrome + fetch ----
  await t('content.js: badges appear, cache + dedupe work, 429 backs off', async () => {
    const d = new JSDOM(F.TWEET_HTML + F.TWEET_HTML.replace('/jack/status/20', '/jack/status/21'),
      { url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = d.window;
    w.document.cookie = 'ct0=testcsrf';
    const store = {};
    const calls = [];
    let rateLimitOnce = true;
    w.chrome = {
      storage: { local: {
        get: async keys => { if (keys === null) return { ...store }; const o = {}; for (const k of [].concat(keys)) if (k in store) o[k] = store[k]; return o; },
        set: async o => { Object.assign(store, o); },
        remove: async k => { for (const x of [].concat(k)) delete store[x]; }
      }, onChanged: { addListener() {} } },
      runtime: { sendMessage: async () => ({ queryId: null }) }
    };
    w.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(el) { setTimeout(() => this.cb([{ isIntersecting: true, target: el }]), 0); } unobserve() {} };
    w.CSS = { escape: s => s };
    w.fetch = async (url, opts) => {
      calls.push({ url, opts });
      const sn = JSON.parse(decodeURIComponent(url.split('variables=')[1])).screenName;
      if (sn === 'quoted_person' && rateLimitOnce) {
        rateLimitOnce = false;
        return { ok: false, status: 429, headers: { get: h => h === 'x-rate-limit-reset' ? String(Math.floor(Date.now() / 1000) + 1) : null } };
      }
      const body = sn === 'jack'
        ? F.about('jack', { account_based_in: 'United States', location_accurate: true, source: 'United States App Store' })
        : F.about(sn, { account_based_in: 'India', location_accurate: false, source: 'India Android App' });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
    };
    for (const f of ['countries.js', 'lib.js', 'content.js']) w.eval(fs.readFileSync(path.join(DIST, f), 'utf8'));

    const waitFor = async (pred, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('timeout'); };
    await waitFor(() => w.document.querySelectorAll('.cf-badge:not(.cf-pending)').length === 4);

    const badges = [...w.document.querySelectorAll('.cf-badge')];
    const jack = badges.filter(b => b.getAttribute('data-cf-for') === 'jack');
    assert.strictEqual(jack.length, 2);
    assert.ok(jack[0].textContent.includes('United States'));
    const q = badges.find(b => b.getAttribute('data-cf-for') === 'quoted_person');
    assert.ok(q.classList.contains('cf-warn'), 'VPN-flagged account gets warning style');
    // badge sits inside the User-Name name row
    assert.ok(jack[0].parentElement.classList.contains('name-row'));
    // jack looked up once despite appearing twice (dedupe); quoted_person twice (429 then retry)
    const n = h => calls.filter(c => c.url.includes(encodeURIComponent('"' + h + '"'))).length;
    assert.strictEqual(n('jack'), 1);
    assert.strictEqual(n('quoted_person'), 2);
    // auth headers
    const h = calls[0].opts.headers;
    assert.strictEqual(h['x-csrf-token'], 'testcsrf');
    assert.ok(/^Bearer /.test(h.authorization));
    assert.strictEqual(calls[0].opts.credentials, 'include');
    assert.ok(calls[0].url.startsWith('https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery?variables='));
    assert.ok(store['cf:h:jack'] && store['cf:h:jack'].basedIn === 'United States', 'cached in storage');
    assert.ok(store['cf:pauseUntil'] > 0, 'pause recorded after 429');
    w.close();
  });

  await t('Ask Grok prompt: VPN + source + stated location', () => {
    const p = L.buildGrokPrompt('@Someone', { basedIn: 'Nigeria', accurate: false, source: 'United States App Store' }, 'Lagos');
    assert.strictEqual(p, 'Tell me about the X account @Someone. X\u2019s About this account says it\u2019s based in Nigeria and connects via the United States App Store; X notes the location may not be accurate (possible VPN/proxy). Its self-reported profile location is \u201cLagos\u201d. Based on its public posts and replies, what country or region does it most likely operate from? Give your confidence and the clues, keep it at country level, and remember location alone doesn\u2019t say whether its posts are accurate.');
  });
  await t('Ask Grok prompt: no VPN, unknown parts omitted', () => {
    const p = L.buildGrokPrompt('jack', { basedIn: 'United States', accurate: true, source: null }, '');
    assert.ok(p.includes('says it\u2019s based in United States.'));
    assert.ok(!/VPN|connects via|self-reported/.test(p));
    const q = L.buildGrokPrompt('jack', null, '');
    assert.ok(q.startsWith('Tell me about the X account @jack. Based on its public posts'));
    const r = L.buildGrokPrompt('jack', { basedIn: null, accurate: false, source: 'Web' }, '');
    assert.ok(r.includes('says it connects via the web; X notes the location may not be accurate'));
    assert.ok(!/misinformation|disinformation/i.test(p + q + r));
  });
  await t('Ask Grok URL is grok.com/?q= with encoding', () => {
    const u = L.grokUrl('a b&c#d?\u201c\u00e9\u201d');
    assert.strictEqual(u, 'https://grok.com/?q=a%20b%26c%23d%3F%E2%80%9C%C3%A9%E2%80%9D');
    assert.strictEqual(new URL(u).searchParams.get('q'), 'a b&c#d?\u201c\u00e9\u201d');
  });
  await t('badge click asks Grok and prevents X navigation', async () => {
    const d = new JSDOM('<a id="lnk" href="/someone"><span id="slot"></span></a>', { url: 'https://x.com/home' });
    const w = d.window; const opened = []; let copied = null; let navigated = 0;
    w.open = (...a) => { opened.push(a); return null; };
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async s => { copied = s; } }, configurable: true });
    w.document.getElementById('lnk').addEventListener('click', e => { if (!e.defaultPrevented) navigated++; });
    const info = { basedIn: 'Nigeria', accurate: false, source: 'United States App Store' };
    const b = L.renderBadge(w.document, info, {}, '', 'someone');
    w.document.getElementById('slot').appendChild(b);
    assert.strictEqual(b.getAttribute('role'), 'button'); assert.strictEqual(b.getAttribute('tabindex'), '0');
    assert.ok(b.classList.contains('cf-ask')); assert.ok(/Click to ask Grok/.test(b.title));
    let outer = 0; w.document.addEventListener('click', () => outer++);
    const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    b.dispatchEvent(ev);
    assert.ok(ev.defaultPrevented); assert.strictEqual(navigated, 0); assert.strictEqual(outer, 0);
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(opened[0][1], '_blank'); assert.strictEqual(opened[0][2], 'noopener');
    const q = new URL(opened[0][0]).searchParams.get('q');
    assert.ok(opened[0][0].startsWith('https://grok.com/?q=')); assert.ok(q.includes('@someone') && q.includes('Nigeria'));
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(copied, q);
    assert.ok(/Prompt copied, opening Grok/.test(w.document.querySelector('.cf-toast').textContent));
    const k = new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    b.dispatchEvent(k); assert.ok(k.defaultPrevented); assert.strictEqual(opened.length, 2);
    const sp = new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    b.dispatchEvent(sp); assert.strictEqual(opened.length, 3);
    // pending badges are not clickable
    assert.ok(!L.renderBadge(w.document, { pending: true }, {}, '', 'someone').hasAttribute('role'));
    w.close();
  });
  await t('askGrok=false leaves badges as before', () => {
    const d = new JSDOM('<a id="lnk" href="/someone"><span id="slot"></span></a>', { url: 'https://x.com/home' });
    const w = d.window; let opened = 0; w.open = () => { opened++; };
    const b = L.renderBadge(w.document, { basedIn: 'Nigeria', accurate: false }, { askGrok: false }, '', 'someone');
    w.document.getElementById('slot').appendChild(b);
    assert.ok(!b.hasAttribute('role') && !b.hasAttribute('tabindex') && !b.classList.contains('cf-ask'));
    assert.ok(!/Grok/.test(b.title));
    const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    b.dispatchEvent(ev);
    assert.ok(!ev.defaultPrevented); assert.strictEqual(opened, 0);
    assert.strictEqual(L.DEFAULT_SETTINGS.askGrok, true);
    w.close();
  });

  setTimeout(() => process.exit(process.exitCode || 0), 10);
  console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
})();
