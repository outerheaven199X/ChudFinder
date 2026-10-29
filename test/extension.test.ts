// Integration tests against the BUILT extension in dist/ (run `npm run build` first; `npm test` does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { inflateRawSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { AccountObservation, Investigation } from '../src/shared/schemas.ts';
import { obs, post } from './helpers.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'dist');
const F = createRequire(import.meta.url)('./legacy/fixtures.cjs');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function memStore() {
  const store: Record<string, any> = {};
  const listeners: any[] = [];
  const area = {
    get: async (keys: any) => { if (keys === null || keys === undefined) return structuredClone(store); const o: any = {}; for (const k of [].concat(keys)) if (k in store) o[k] = structuredClone(store[k]); return o; },
    set: async (o: any) => { const ch: any = {}; for (const [k, v] of Object.entries(o)) { ch[k] = { newValue: structuredClone(v) }; store[k] = structuredClone(v); } listeners.forEach(l => l(ch, 'local')); },
    remove: async (k: any) => { for (const x of [].concat(k)) delete store[x]; }
  };
  return { store, area, listeners };
}

function worker(opts: { sidePanel?: boolean } = {}) {
  const { store, area } = memStore();
  const calls: any[] = []; const listeners: any = {};
  const chrome: any = {
    runtime: { id: 'me', getURL: (p: string) => 'chrome-extension://me/' + p, onMessage: { addListener: (f: any) => (listeners.msg = f) },
      onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
    alarms: { get: async () => null, create() {}, onAlarm: { addListener() {} } },
    permissions: { contains: async () => false },
    storage: { local: area },
    tabs: { create: (o: any) => calls.push(['tabs.create', o]), query: async () => [], sendMessage: async () => null }
  };
  if (opts.sidePanel !== false) chrome.sidePanel = { open: (o: any) => { calls.push(['sidePanel.open', o]); return Promise.resolve(); }, setPanelBehavior: () => Promise.resolve() };
  const ctx: any = { chrome, console, TextEncoder, TextDecoder, crypto: globalThis.crypto, URL, btoa, atob, fetch: async () => { throw new Error('no network in tests'); } };
  ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(DIST, 'src/background.js'), 'utf8'), ctx);
  const send = (msg: any, sender: any = { id: 'me', tab: { id: 7 } }) => new Promise<any>(r => { const ret = listeners.msg(msg, sender, r); if (ret === false) r('__ignored__'); });
  return { store, calls, send, listeners };
}

test('manifest + build output: MV3, side panel, every referenced file exists, zip has manifest at root', () => {
  const m = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3); assert.equal(m.version, pkg.version);
  assert.ok(m.permissions.includes('sidePanel')); assert.equal(m.side_panel.default_path, 'src/sidepanel.html');
  const files = [m.background.service_worker, m.action.default_popup, m.options_page, m.side_panel.default_path,
    ...m.content_scripts.flatMap((c: any) => [...(c.js || []), ...(c.css || [])]), ...Object.values(m.icons), ...m.web_accessible_resources[0].resources];
  for (const f of files) assert.ok(existsSync(join(DIST, f as string)), f as string);
  for (const html of ['src/sidepanel.html', 'src/popup.html', 'src/options.html']) {
    for (const [, src] of readFileSync(join(DIST, html), 'utf8').matchAll(/<script src="([^"]+)"/g)) assert.ok(existsSync(join(DIST, 'src', src)), html + ' -> ' + src);
  }
  const zip = readFileSync(join(root, 'chud-finder-' + pkg.version + '.zip'));
  const names: string[] = []; let i = 0;
  while (zip.readUInt32LE(i) === 0x04034b50) {
    const n = zip.readUInt16LE(26 + i), size = zip.readUInt32LE(18 + i);
    names.push(zip.subarray(i + 30, i + 30 + n).toString());
    if (names[names.length - 1] === 'manifest.json') assert.equal(JSON.parse(inflateRawSync(zip.subarray(i + 30 + n, i + 30 + n + size)).toString()).version, pkg.version);
    i += 30 + n + size;
  }
  assert.ok(names.includes('manifest.json'), 'manifest.json at zip root'); assert.ok(names.includes('src/sidepanel.js'));
  assert.ok(!names.some(n => n.startsWith('chud-finder/')), 'no nested folder');
});

test('background: Investigate opens the side panel synchronously, stores a versioned investigation', async () => {
  const w = worker();
  const o = obs('vllm_project', { basedIn: 'United States', accurate: true, source: 'Web' }, { posts: [post('1', 'vllm_project', 'vLLM v1 release notes are out today')] });
  const p = w.send({ type: 'investigate', observation: o });
  assert.equal(JSON.stringify(w.calls[0]), JSON.stringify(['sidePanel.open', { tabId: 7 }]), 'opened before any await (keeps the user gesture)');
  const r = await p;
  assert.equal(r.ok, true); assert.equal(r.version, 1);
  const inv = Investigation.parse(w.store['cf:inv:' + r.id]);
  assert.equal(inv.subject.handle, 'vllm_project');
  assert.equal(w.store['cf:activeInv'], r.id);
  assert.equal(w.store['cf:invIndex'][0].handle, 'vllm_project');
  const r2 = await w.send({ type: 'investigate', observation: { ...o, observedAt: '2026-10-30T00:00:00.000Z' } });
  assert.equal(r2.version, 2); assert.equal(w.store['cf:inv:' + r.id].snapshots.length, 2);
  assert.equal(w.store['cf:invIndex'].length, 1);
});

test('background: rejects malformed observations and other extensions; falls back to a tab without sidePanel', async () => {
  const w = worker({ sidePanel: false });
  const bad = await w.send({ type: 'investigate', observation: { handle: 'x', posts: 'nope' } });
  assert.equal(bad.ok, false); assert.match(bad.error, /observation rejected/);
  assert.equal(await w.send({ type: 'investigate', observation: obs('a', null) }, { id: 'evil', tab: { id: 1 } }), '__ignored__');
  const ok = await w.send({ type: 'investigate', observation: obs('a', null) });
  assert.equal(ok.ok, true);
  assert.equal(w.calls[0][0], 'tabs.create'); assert.match(w.calls[0][1].url, /sidepanel\.html\?inv=inv_/);
});

function contentPage(settings: any = {}) {
  const d = new JSDOM(F.TWEET_HTML, { url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true });
  const w: any = d.window;
  w.document.cookie = 'ct0=testcsrf';
  const { store, area } = memStore();
  store.settings = settings;
  const sent: any[] = [];
  w.chrome = { storage: { local: area, onChanged: { addListener() {} } },
    runtime: { id: 'me', sendMessage: async (m: any) => { sent.push(m); return { ok: true }; }, onMessage: { addListener() {} } } };
  w.IntersectionObserver = class { cb: any; constructor(cb: any) { this.cb = cb; } observe(el: any) { setTimeout(() => this.cb([{ isIntersecting: true, target: el }]), 0); } unobserve() {} };
  w.CSS = { escape: (s: string) => s };
  w.fetch = async (url: string) => {
    const sn = JSON.parse(decodeURIComponent(url.split('variables=')[1])).screenName;
    const body = sn === 'jack' ? F.about('jack', { account_based_in: 'United States', location_accurate: true, source: 'United States App Store' })
      : F.about(sn, { account_based_in: 'India', location_accurate: false });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
  w.open = (...a: any[]) => sent.push({ type: '__open', a });
  w.eval(readFileSync(join(DIST, 'src/content.js'), 'utf8'));
  const waitFor = async (pred: () => any, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return; await new Promise(r => setTimeout(r, 30)); } throw new Error('timeout'); };
  return { d, w, sent, waitFor };
}

test('content: badge click opens the provenance popover; Investigate submits a schema-valid observation', async () => {
  const { w, sent, waitFor } = contentPage();
  // X's own timeline data (relayed by page.js) contributes posts with times + language tags.
  // As page.js would post them (jsdom does not set event.source for postMessage, so dispatch directly).
  const relay = (data: any) => w.dispatchEvent(new w.MessageEvent('message', { data: { __chudFinder: true, ...data }, source: w }));
  relay({ type: 'posts', payload: [{ id: '19', handle: 'jack', text: 'earlier post', createdAt: 'Tue Mar 21 20:00:00 +0000 2006', lang: 'en', links: ['https://example.com/x', 'javascript:bad'], quotedPostId: null, replyToHandle: null }] });
  relay({ type: 'locations', payload: { jack: 'San Francisco, CA' } });
  await new Promise(r => setTimeout(r, 50));
  await waitFor(() => w.document.querySelectorAll('.cf-badge:not(.cf-pending)').length === 2);
  const badge = w.document.querySelector('.cf-badge[data-cf-for="jack"]');
  badge.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const pop = w.document.querySelector('.cf-pop');
  assert.ok(pop, 'popover opened');
  assert.ok(!sent.some(m => m.type === '__open'), 'click no longer jumps straight to Grok');
  const text = pop.textContent;
  assert.match(text, /@jack/); assert.match(text, /United States/); assert.match(text, /United States App Store/);
  assert.match(text, /San Francisco, CA/); assert.match(text, /Self-reported/); assert.match(text, /seen in your session/);
  const btns = [...pop.querySelectorAll('button')].map((b: any) => b.textContent);
  assert.ok(btns.includes('Investigate') && btns.includes('Ask Grok'));
  [...pop.querySelectorAll('button')].find((b: any) => b.textContent === 'Investigate').click();
  const m = sent.find(x => x.type === 'investigate');
  assert.ok(m, 'investigate message sent');
  const o = AccountObservation.parse(m.observation);
  assert.equal(o.handle, 'jack'); assert.equal(o.about!.basedIn, 'United States');
  assert.equal(o.profileLocation!.text, 'San Francisco, CA');
  assert.equal(o.focusPostId, '20');
  assert.deepEqual(o.posts.map(p => p.id).sort(), ['19', '20']);
  assert.deepEqual(o.posts.find(p => p.id === '19')!.links, ['https://example.com/x'], 'unsafe links dropped');
  assert.equal(w.document.querySelector('.cf-pop'), null, 'popover closes after Investigate');
  // Escape closes; Ask Grok still works from the popover.
  badge.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(w.document.querySelector('.cf-pop'), null);
  badge.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  [...w.document.querySelectorAll('.cf-pop button')].find((b: any) => b.textContent === 'Ask Grok').click();
  const open = sent.find(x => x.type === '__open');
  assert.ok(open && open.a[0].startsWith('https://grok.com/?q='));
  w.close();
});

test('content: popover=false keeps the 1.2.0 click-to-Ask-Grok behaviour', async () => {
  const { w, sent, waitFor } = contentPage({ popover: false });
  await waitFor(() => w.document.querySelectorAll('.cf-badge:not(.cf-pending)').length === 2);
  w.document.querySelector('.cf-badge[data-cf-for="jack"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(w.document.querySelector('.cf-pop'), null);
  assert.ok(sent.some(m => m.type === '__open'));
  w.close();
});

test('page.js relays posts from X timeline responses (id, text, time, lang, links)', async () => {
  const d = new JSDOM('', { url: 'https://x.com/home', runScripts: 'outside-only' });
  const w: any = d.window; const msgs: any[] = [];
  w.addEventListener('message', (e: any) => { if (e.data && e.data.__chudFinder) msgs.push(e.data); });
  const tl = { data: { x: { result: { __typename: 'Tweet', rest_id: '555', core: { user_results: { result: { __typename: 'User', core: { screen_name: 'vllm_project' } } } },
    legacy: { full_text: 'hello <b>world</b>', created_at: 'Wed Oct 28 12:00:00 +0000 2026', lang: 'en', entities: { urls: [{ expanded_url: 'https://docs.vllm.ai' }] }, in_reply_to_screen_name: 'someone' } } } } };
  w.fetch = async () => ({ headers: new w.Headers({ 'content-type': 'application/json' }), clone() { return { json: async () => tl }; } });
  w.eval(readFileSync(join(DIST, 'src/page.js'), 'utf8'));
  await w.fetch('https://x.com/i/api/graphql/abcdefghijklmnop12/UserTweets?x=1', { headers: {} });
  await new Promise(r => setTimeout(r, 50));
  const p = msgs.find(m => m.type === 'posts');
  assert.ok(p); assert.equal(p.payload[0].id, '555'); assert.equal(p.payload[0].handle, 'vllm_project');
  assert.deepEqual(p.payload[0].links, ['https://docs.vllm.ai']); assert.equal(p.payload[0].replyToHandle, 'someone');
  w.close();
});
