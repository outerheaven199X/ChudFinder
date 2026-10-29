/* Run: node test/settings.test.js  (no dependencies) */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
require('../src/countries.js');
require('../src/lib.js');
const S = require('../src/settings-schema.js');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); process.exitCode = 1; }
}

(async () => {
  await t('valid full document; names resolve to ISO codes; dupes removed', () => {
    const r = S.validate({ schemaVersion: 1, enabled: false, showName: true, vpnWarnings: false, mismatchWarnings: true,
      topicMode: true, homeCountry: 'united kingdom', highlightCountries: ['ca', 'Mexico', 'CA', 'Russian Federation'] });
    assert.ok(r.ok, r.errors.join());
    assert.deepStrictEqual(r.settings, { enabled: false, showName: true, vpnWarnings: false, mismatchWarnings: true,
      topicMode: true, homeCountry: 'GB', highlightCountries: ['CA', 'MX', 'RU'] });
  });
  await t('schemaVersion required and must be 1', () => {
    assert.ok(!S.validate({ enabled: true }).ok);
    assert.ok(!S.validate({ schemaVersion: 2 }).ok);
    assert.ok(!S.validate({ schemaVersion: '1' }).ok);
  });
  await t('wrong types reject the whole document', () => {
    const r = S.validate({ schemaVersion: 1, enabled: 'yes', topicMode: true });
    assert.ok(!r.ok && r.settings === null && /enabled/.test(r.errors[0]));
    assert.ok(!S.validate({ schemaVersion: 1, highlightCountries: 'US' }).ok);
    assert.ok(!S.validate({ schemaVersion: 1, homeCountry: 5 }).ok);
    assert.ok(!S.validate([]).ok && !S.validate(null).ok);
  });
  await t('unknown countries rejected; too many rejected', () => {
    const r = S.validate({ schemaVersion: 1, highlightCountries: ['US', 'Atlantis'] });
    assert.ok(!r.ok && /Atlantis/.test(r.errors.join()));
    assert.ok(!S.validate({ schemaVersion: 1, homeCountry: 'ZZ' }).ok);
    assert.ok(!S.validate({ schemaVersion: 1, highlightCountries: Array(301).fill('US') }).ok);
  });
  await t('unknown keys ignored with a warning, never copied', () => {
    const r = S.validate({ schemaVersion: 1, enabled: true, script: 'alert(1)', __proto__x: 1, note: 'hi', updatedAt: 'x' });
    assert.ok(r.ok);
    assert.deepStrictEqual(r.settings, { enabled: true });
    assert.strictEqual(r.warnings.length, 2);
  });
  await t('prototype pollution attempt has no effect', () => {
    const r = S.parseAndValidate('{"schemaVersion":1,"__proto__":{"polluted":true},"constructor":{"x":1}}');
    assert.ok(r.ok);
    assert.strictEqual(({}).polluted, undefined);
    assert.strictEqual(Object.keys(r.settings).length, 0);
  });
  await t('parseAndValidate: bad JSON and oversize', () => {
    assert.ok(!S.parseAndValidate('{nope').ok);
    assert.ok(!S.parseAndValidate('{"schemaVersion":1,"note":"' + 'x'.repeat(70000) + '"}').ok);
  });
  await t('merge keeps keys not in the document and copies arrays', () => {
    const cur = { enabled: true, showName: true, highlightCountries: ['US'], homeCountry: 'US', topicMode: false };
    const inc = { topicMode: true, highlightCountries: ['CA'] };
    const m = S.merge(cur, inc);
    assert.deepStrictEqual(m, { enabled: true, showName: true, highlightCountries: ['CA'], homeCountry: 'US', topicMode: true });
    inc.highlightCountries.push('MX');
    assert.deepStrictEqual(m.highlightCountries, ['CA']);
    assert.deepStrictEqual(cur.highlightCountries, ['US']);
    assert.deepStrictEqual(S.merge(cur, { highlightCountries: [] }).highlightCountries, []);
  });
  await t('export/import code round trip (incl. URL-safe base64 and raw JSON)', () => {
    const settings = { enabled: true, showName: false, vpnWarnings: true, mismatchWarnings: false, topicMode: true, homeCountry: 'CI', highlightCountries: ['NG', 'IN'] };
    const code = S.exportCode(settings);
    const r = S.importCode(code);
    assert.ok(r.ok, r.errors.join());
    assert.deepStrictEqual(r.settings, settings);
    assert.ok(S.importCode(code.replace(/\+/g, '-').replace(/\//g, '_')).ok);
    assert.ok(S.importCode('{"schemaVersion":1,"topicMode":false}').ok);
    assert.ok(!S.importCode('!!!').ok);
    assert.ok(!S.importCode(Buffer.from('not json').toString('base64')).ok);
    assert.strictEqual(Buffer.from(code, 'base64').toString().startsWith('{"schemaVersion":1'), true);
  });
  await t('source URL must be plain https', () => {
    assert.ok(S.checkSourceUrl('https://gist.githubusercontent.com/u/abc/raw/chud-finder-settings.json'));
    assert.strictEqual(S.checkSourceUrl('http://example.com/x.json'), null);
    assert.strictEqual(S.checkSourceUrl('https://user:pw@example.com/x'), null);
    assert.strictEqual(S.checkSourceUrl('javascript:alert(1)'), null);
    assert.strictEqual(S.checkSourceUrl('not a url'), null);
  });

  // ---- background.js sync, run in a VM with mocked chrome.* and fetch ----
  function makeWorker(remote) {
    const store = { settings: { enabled: true, showName: true, highlightCountries: [], vpnWarnings: true, mismatchWarnings: true, topicMode: false, homeCountry: 'US' } };
    const listeners = {};
    const granted = new Set();
    const alarms = {};
    const fetches = [];
    const chrome = {
      runtime: { id: 'me', onMessage: { addListener: f => (listeners.msg = f) }, onStartup: { addListener: f => (listeners.startup = f) }, onInstalled: { addListener: f => (listeners.installed = f) } },
      alarms: { get: async n => alarms[n], create: (n, o) => { alarms[n] = o; }, onAlarm: { addListener: f => (listeners.alarm = f) } },
      permissions: { contains: async ({ origins }) => origins.every(o => granted.has(o)) },
      storage: { local: {
        get: async keys => { const o = {}; for (const k of [].concat(keys)) if (k in store) o[k] = JSON.parse(JSON.stringify(store[k])); return o; },
        set: async o => { Object.assign(store, JSON.parse(JSON.stringify(o))); }
      } }
    };
    const ctx = { chrome, console, TextEncoder, TextDecoder, crypto: globalThis.crypto, URL, btoa, atob,
      fetch: async (url, opts) => { fetches.push({ url, opts }); return remote(url); } };
    ctx.self = ctx; ctx.globalThis = ctx;
    ctx.importScripts = (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), ctx); };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf8'), ctx);
    const send = msg => new Promise(r => { listeners.msg(msg, { id: 'me' }, r); });
    return { store, listeners, granted, alarms, fetches, send };
  }
  const resp = (body, status = 200) => ({ ok: status === 200, status, url: 'https://gist.githubusercontent.com/x', headers: { get: () => null }, text: async () => body });
  const URL1 = 'https://gist.githubusercontent.com/u/abc/raw/chud-finder-settings.json';

  await t('background: applies remote settings, records "synced" state, creates 10-min alarm', async () => {
    const w = makeWorker(() => resp(JSON.stringify({ schemaVersion: 1, topicMode: true, highlightCountries: ['Canada'], extra: 1 })));
    w.store.syncUrl = URL1; w.granted.add('https://gist.githubusercontent.com/*');
    const r = await w.send({ type: 'syncNow' });
    assert.ok(r.ok);
    assert.strictEqual(w.store.settings.topicMode, true);
    assert.deepStrictEqual(w.store.settings.highlightCountries, ['CA']);
    assert.strictEqual(w.store.settings.showName, true, 'untouched keys kept');
    assert.ok(w.store.syncState.lastSync > 0 && w.store.syncState.error === null);
    assert.strictEqual(w.store.syncState.warnings.length, 1);
    assert.strictEqual(w.alarms['cf-settings-sync'].periodInMinutes, 10);
    assert.strictEqual(w.fetches[0].opts.credentials, 'omit');
  });
  await t('background: same remote doc does not overwrite local edits; changed doc does', async () => {
    let doc = { schemaVersion: 1, topicMode: true };
    const w = makeWorker(() => resp(JSON.stringify(doc)));
    w.store.syncUrl = URL1; w.granted.add('https://gist.githubusercontent.com/*');
    await w.send({ type: 'syncNow' });
    w.store.settings.topicMode = false;              // user flips it locally
    await new Promise(r => { w.listeners.alarm({ name: 'cf-settings-sync' }); setTimeout(r, 50); });
    assert.strictEqual(w.store.settings.topicMode, false, 'unchanged remote doc must not clobber local change');
    doc = { schemaVersion: 1, topicMode: true, vpnWarnings: false };
    await new Promise(r => { w.listeners.alarm({ name: 'cf-settings-sync' }); setTimeout(r, 50); });
    assert.strictEqual(w.store.settings.topicMode, true);
    assert.strictEqual(w.store.settings.vpnWarnings, false);
  });
  await t('background: invalid doc rejected, settings untouched, error shown', async () => {
    const w = makeWorker(() => resp('{"schemaVersion":1,"enabled":"nope"}'));
    w.store.syncUrl = URL1; w.granted.add('https://gist.githubusercontent.com/*');
    const before = JSON.stringify(w.store.settings);
    await w.send({ type: 'syncNow' });
    assert.strictEqual(JSON.stringify(w.store.settings), before);
    assert.ok(/rejected/.test(w.store.syncState.error));
  });
  await t('background: no permission / http URL / HTTP error -> error, no fetch', async () => {
    const w = makeWorker(() => resp('{}', 500));
    w.store.syncUrl = URL1;
    await w.send({ type: 'syncNow' });
    assert.ok(/Permission/.test(w.store.syncState.error)); assert.strictEqual(w.fetches.length, 0);
    w.store.syncUrl = 'http://example.com/x.json';
    await w.send({ type: 'syncNow' });
    assert.ok(/https/.test(w.store.syncState.error)); assert.strictEqual(w.fetches.length, 0);
    w.store.syncUrl = URL1; w.granted.add('https://gist.githubusercontent.com/*');
    await w.send({ type: 'syncNow' });
    assert.ok(/HTTP 500/.test(w.store.syncState.error));
  });
  await t('askGrok: validated as strict boolean, round-trips through codes', () => {
    const S = require('../src/settings-schema.js');
    const ok = S.validate({ schemaVersion: 1, askGrok: false });
    assert.ok(ok.ok); assert.strictEqual(ok.settings.askGrok, false); assert.deepStrictEqual(ok.warnings, []);
    const bad = S.validate({ schemaVersion: 1, askGrok: 'no' });
    assert.ok(!bad.ok); assert.ok(bad.errors.some(e => /askGrok must be true or false/.test(e)));
    const unk = S.validate({ schemaVersion: 1, askGrokk: true });
    assert.ok(unk.ok); assert.ok(unk.warnings.some(w => /askGrokk/.test(w)));
    const back = S.importCode(S.exportCode({ askGrok: false, homeCountry: 'US', highlightCountries: [] }));
    assert.ok(back.ok); assert.strictEqual(back.settings.askGrok, false);
  });
  await t('background: ignores messages from other extensions', () => {
    const w = makeWorker(() => resp('{}'));
    assert.strictEqual(w.listeners.msg({ type: 'syncNow' }, { id: 'evil' }, () => {}), false);
  });

  console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
})();
