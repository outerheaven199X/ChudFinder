/* Chud Finder side panel workspace: Overview | Origin | Narrative | Claims | Evidence. */
import { currentSnapshot } from '../shared/engine.ts';
import { buildExport, threadDraft } from '../shared/receipts.ts';
import { Investigation } from '../shared/schemas.ts';
import { el, renderTab, TABS } from './render.ts';
import type { Tab } from './render.ts';
import { drawReceipt } from './receipt-png.ts';
import { ACTIVE_KEY, INDEX_KEY, INV_PREFIX, deleteInvestigation, loadInvestigation } from './store.ts';
import type { IndexEntry } from './store.ts';
import { GROK_BOT_TEMPLATE_URL } from './config.ts';

declare const chrome: any;
const $ = (id: string) => document.getElementById(id)!;
const store = chrome.storage.local;

let inv: Investigation | null = null;
let version: number | undefined;
let tab: Tab = 'Overview';
let evidenceAll = false;
let botUrl = GROK_BOT_TEMPLATE_URL;

function download(name: string, blob: Blob) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}

function status(msg: string, cls = '') { const s = $('status'); s.textContent = msg; s.className = 'status mono ' + cls; }

function note(type: string) {
  // Record export events in the investigation's event log.
  if (!inv) return;
  const at = new Date().toISOString();
  const next = { ...inv, events: [...inv.events, { at, type: 'exported' as const, version: currentSnapshot(inv, version).version, detail: 'Exported ' + type }].slice(-200) };
  const ok = Investigation.safeParse(next);
  if (ok.success) { inv = ok.data; store.set({ [INV_PREFIX + inv.id]: inv }); }
}

function onAction(a: { type: string; [k: string]: unknown }) {
  if (!inv) return;
  const fname = 'chud-finder-' + inv.subject.handle + '-v' + currentSnapshot(inv, version).version;
  switch (a.type) {
    case 'ask-grok': window.open(String(a.url), '_blank', 'noopener'); break;
    case 'show-evidence': {
      tab = 'Evidence'; evidenceAll = true; render();
      const t = document.getElementById('evidence-' + a.id);
      if (t) { t.classList.add('flash'); if (typeof t.scrollIntoView === 'function') t.scrollIntoView({ block: 'center' }); }
      break;
    }
    case 'evidence-scope': evidenceAll = !!a.all; render(); break;
    case 'export-json': download(fname + '.json', new Blob([JSON.stringify(buildExport(inv, version), null, 2)], { type: 'application/json' })); note('JSON'); break;
    case 'export-png': {
      const c = document.createElement('canvas'); drawReceipt(c, inv, version);
      c.toBlob(b => { if (b) { download(fname + '.png', b); note('PNG'); } }, 'image/png'); break;
    }
    case 'thread': {
      const parts = threadDraft(inv, version);
      const box = $('thread') as HTMLTextAreaElement; box.value = parts.join('\n\n');
      $('threadWrap').hidden = false; box.focus(); box.select(); note('X thread draft'); break;
    }
  }
}

function render() {
  const nav = $('tabs'); nav.textContent = '';
  for (const t of TABS) {
    const b = el(document, 'button', 'tab mono' + (t === tab ? ' active' : ''), t.toUpperCase());
    b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(t === tab));
    b.addEventListener('click', () => { tab = t; render(); });
    nav.appendChild(b);
  }
  const main = $('main'); main.textContent = '';
  const vsel = $('version') as HTMLSelectElement; vsel.textContent = '';
  if (!inv) {
    main.appendChild(el(document, 'p', 'na', 'No investigation yet. On X, click a country badge and choose Investigate.'));
    (vsel as any).hidden = true; return;
  }
  (vsel as any).hidden = false;
  for (const s of [...inv.snapshots].reverse()) vsel.add(new Option('v' + s.version + ' \u00b7 ' + new Date(s.createdAt).toLocaleString(), String(s.version)));
  vsel.value = String(version ?? inv.currentVersion);
  main.appendChild(renderTab({ doc: document, inv, version, grokBotTemplateUrl: botUrl, onAction }, tab, { evidenceAll }));
}

async function renderRecent() {
  const got = await store.get(INDEX_KEY);
  const idx: IndexEntry[] = got[INDEX_KEY] || [];
  const sel = $('recent') as HTMLSelectElement; sel.textContent = '';
  if (!idx.length) sel.add(new Option('No investigations', ''));
  for (const e of idx) sel.add(new Option('@' + e.handle + ' \u00b7 v' + e.version, e.id));
  if (inv) sel.value = inv.id;
}

async function show(id: string | null) {
  inv = id ? await loadInvestigation(store, id) : null;
  version = undefined; evidenceAll = false;
  await renderRecent(); render();
  if (inv) status('Updated ' + new Date(inv.updatedAt).toLocaleString());
}

async function init() {
  const q = new URLSearchParams(location.search).get('inv');
  const got = await store.get([ACTIVE_KEY, 'settings']);
  if (got.settings && typeof got.settings.grokBotTemplateUrl === 'string' && got.settings.grokBotTemplateUrl) botUrl = got.settings.grokBotTemplateUrl;
  await show(q || got[ACTIVE_KEY] || null);
  ($('recent') as HTMLSelectElement).addEventListener('change', e => show((e.target as HTMLSelectElement).value || null));
  ($('version') as HTMLSelectElement).addEventListener('change', e => { version = Number((e.target as HTMLSelectElement).value); render(); });
  $('refresh').addEventListener('click', async () => {
    if (!inv) return;
    status('Refreshing from the open X tab\u2026');
    const r = await chrome.runtime.sendMessage({ type: 'reinvestigate', handle: inv.subject.handle });
    if (!r || !r.ok) status((r && r.error) || 'Refresh failed', 'amber');
  });
  $('delete').addEventListener('click', async () => {
    if (!inv) return;
    await deleteInvestigation(store, inv.id);
    const g = await store.get(ACTIVE_KEY); await show(g[ACTIVE_KEY] || null); status('Deleted.');
  });
  $('copyThread').addEventListener('click', async () => {
    const box = $('thread') as HTMLTextAreaElement;
    try { await navigator.clipboard.writeText(box.value); status('Thread draft copied. Nothing was posted.'); } catch { box.select(); document.execCommand('copy'); }
  });
  $('closeThread').addEventListener('click', () => { $('threadWrap').hidden = true; });
  chrome.storage.onChanged.addListener((ch: any, area: string) => {
    if (area !== 'local') return;
    if (ch[ACTIVE_KEY] && ch[ACTIVE_KEY].newValue) { show(ch[ACTIVE_KEY].newValue); return; }
    if (ch[ACTIVE_KEY + ':pending'] && ch[ACTIVE_KEY + ':pending'].newValue) status('Investigating @' + ch[ACTIVE_KEY + ':pending'].newValue.handle + '\u2026');
    if (inv && ch[INV_PREFIX + inv.id] && ch[INV_PREFIX + inv.id].newValue) {
      const r = Investigation.safeParse(ch[INV_PREFIX + inv.id].newValue);
      if (r.success && r.data.currentVersion !== inv.currentVersion) { inv = r.data; version = undefined; renderRecent(); render(); status('Updated to v' + inv.currentVersion); }
    }
    if (ch.settings && ch.settings.newValue) { botUrl = ch.settings.newValue.grokBotTemplateUrl || GROK_BOT_TEMPLATE_URL; render(); }
  });
}
init();
