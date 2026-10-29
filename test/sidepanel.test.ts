// Runs the BUILT side panel (dist/src/sidepanel.html + sidepanel.js) in jsdom with a mocked chrome API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { upsertInvestigation } from '../src/shared/engine.ts';
import { drawReceipt } from '../src/ext/receipt-png.ts';
import { obs, post, T0 } from './helpers.ts';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const inv = upsertInvestigation(null, obs('someone', { basedIn: 'Nigeria', accurate: false, source: 'United States App Store' },
  { posts: [post('5', 'someone', 'A claim that needs checking, with some detail')], focusPostId: '5' }), T0);

async function panel() {
  const html = readFileSync(join(DIST, 'src/sidepanel.html'), 'utf8').replace(/<script src="sidepanel.js"><\/script>/, '');
  const d = new JSDOM(html, { url: 'chrome-extension://me/src/sidepanel.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w: any = d.window;
  const store: any = { ['cf:inv:' + inv.id]: inv, 'cf:invIndex': [{ id: inv.id, handle: 'someone', updatedAt: T0, version: 1, headline: 'h' }], 'cf:activeInv': inv.id,
    settings: { grokBotTemplateUrl: 'https://grok.example/t/chud' } };
  const downloads: string[] = []; const opened: string[] = [];
  w.chrome = { storage: { local: {
    get: async (k: any) => { const o: any = {}; for (const x of [].concat(k)) if (x in store) o[x] = structuredClone(store[x]); return o; },
    set: async (o: any) => Object.assign(store, structuredClone(o)), remove: async () => {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async () => ({ ok: true }) } };
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  w.open = (u: string) => opened.push(u);
  w.eval(readFileSync(join(DIST, 'src/sidepanel.js'), 'utf8'));
  await new Promise(r => setTimeout(r, 100));
  return { w, store, downloads, opened };
}

test('side panel: loads the active investigation, five tabs, Grok Bot link from settings, receipts', async () => {
  const { w, store, downloads, opened } = await panel();
  const doc = w.document;
  const tabs = [...doc.querySelectorAll('#tabs .tab')].map((t: any) => t.textContent);
  assert.deepEqual(tabs, ['OVERVIEW', 'ORIGIN', 'NARRATIVE', 'CLAIMS', 'EVIDENCE']);
  assert.match(doc.querySelector('#main').textContent, /USER-CAPTURED X DISPLAY: Nigeria/);
  assert.equal(doc.querySelector('#recent').value, inv.id);
  assert.equal(doc.querySelectorAll('.story-section').length,7);
  doc.querySelector('button[data-action="export-json"]').click();
  assert.deepEqual(downloads, ['chud-finder-someone-v1.json']);
  doc.querySelector('button[data-action="thread"]').click();
  assert.equal(doc.querySelector('#threadWrap').hidden, false);
  assert.match(doc.querySelector('#thread').value, /^1\/\d+ Provenance check on @someone/);
  assert.equal(store['cf:inv:' + inv.id].currentVersion,1,'export does not overwrite investigation storage');
  [...doc.querySelectorAll('#tabs .tab')].find((t: any) => t.textContent === 'CLAIMS').click();
  assert.equal(doc.querySelectorAll('button[data-action="ask-grok"]').length,0);
  [...doc.querySelectorAll('#tabs .tab')].find((t: any) => t.textContent === 'ORIGIN').click();
  doc.querySelector('button.chip').click();
  assert.ok([...doc.querySelectorAll('#tabs .tab')].find((t: any) => t.classList.contains('active')).textContent === 'EVIDENCE');
  w.close();
});

test('PNG receipt draws handle, headline and labeled findings onto a 1200x675 canvas', () => {
  const texts: string[] = [];
  const ctx: any = new Proxy({ fillText: (t: string) => texts.push(t), measureText: (t: string) => ({ width: t.length * 10 }) }, {
    get: (o: any, k) => (k in o ? o[k] : () => {}), set: () => true });
  const canvas: any = { width: 0, height: 0, getContext: () => ctx };
  drawReceipt(canvas, inv);
  assert.equal(canvas.width, 1200); assert.ok(canvas.height > 675);
  assert.ok(texts.includes('@someone'));
  assert.ok(texts.some(t => t === '[REPORTED]')); assert.ok(texts.some(t => t === '[UNKNOWN]'));
  assert.ok(texts.some(t => /COVERAGE|LIMITS/.test(t)));
});
