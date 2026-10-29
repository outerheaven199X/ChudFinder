/* Chud Finder - service worker.
 * 1) Settings sync: if the user set a "Settings source URL" (https only), fetch it on
 *    startup and every 10 minutes, validate it strictly (data only, never executed),
 *    and apply it when its content changes.
 * 2) Query-id discovery: when the AboutAccountQuery id stops working, read X's own
 *    client JS bundles (already loaded by the page) to find the current id.
 * 3) Investigations: validate observations from the content script, run the deterministic
 *    engine, persist versioned investigations locally and open the side panel.
 */
import * as S from '../shared/settings-schema.ts';
import { DEFAULT_SETTINGS as DEFAULTS } from './lib.ts';
import { AccountObservation } from '../shared/schemas.ts';
import { investigationId, upsertInvestigation } from '../shared/engine.ts';
import { loadInvestigation, saveInvestigation, ACTIVE_KEY } from './store.ts';

declare const chrome: any;
const ALARM = 'cf-settings-sync';
const PERIOD_MIN = 10;

// ---------------- settings sync ----------------
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function setState(patch: Record<string, unknown>) {
  const { syncState = {} } = await chrome.storage.local.get('syncState');
  await chrome.storage.local.set({ syncState: Object.assign(syncState, patch, { lastChecked: Date.now() }) });
}

let syncing: Promise<any> | null = null;
function syncNow(force: boolean): Promise<any> {
  if (!syncing) syncing = doSync(force).finally(() => { syncing = null; });
  return syncing;
}

async function doSync(force: boolean): Promise<any> {
  const { syncUrl, syncState = {} } = await chrome.storage.local.get(['syncUrl', 'syncState']);
  if (!syncUrl) return { ok: true, skipped: true };
  const u = S.checkSourceUrl(syncUrl);
  if (!u) { await setState({ error: 'Settings source URL must be https.' }); return { ok: false }; }

  const origin = u.origin + '/*';
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    await setState({ error: 'Permission to read ' + u.host + ' was not granted. Save the URL again in Settings.' });
    return { ok: false };
  }

  let text: string;
  try {
    const res = await fetch(u.href, { cache: 'no-store', credentials: 'omit', redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (res.url && !res.url.startsWith('https:')) throw new Error('redirected to a non-https URL');
    const len = Number(res.headers.get('content-length') || 0);
    if (len > S.MAX_BYTES) throw new Error('document larger than 64 KB');
    text = await res.text();
  } catch (e: any) {
    await setState({ error: 'Could not fetch settings: ' + (e && e.message || e) });
    return { ok: false };
  }

  const result = S.parseAndValidate(text);
  if (!result.ok) {
    await setState({ error: 'Settings rejected: ' + result.errors.join(' '), warnings: result.warnings });
    return { ok: false, errors: result.errors };
  }

  const hash = await sha256(text);
  // Apply only when the remote document changed, so local tweaks stick until the bot updates it.
  if (force || hash !== syncState.hash) {
    const { settings = {} } = await chrome.storage.local.get('settings');
    const merged = S.merge(Object.assign({}, DEFAULTS, settings), result.settings);
    await chrome.storage.local.set({ settings: merged });
  }
  await setState({ error: null, hash, lastSync: Date.now(), warnings: result.warnings, url: u.href });
  return { ok: true, warnings: result.warnings };
}

async function ensureAlarm() {
  const a = await chrome.alarms.get(ALARM);
  if (!a) chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN, delayInMinutes: PERIOD_MIN });
}

chrome.alarms.onAlarm.addListener((a: any) => { if (a.name === ALARM) syncNow(false); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); syncNow(false); });

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) await chrome.storage.local.set({ settings: Object.assign({}, DEFAULTS, { highlightCountries: [] }) });
  await ensureAlarm();
  syncNow(false);
});

// ---------------- query-id discovery ----------------
const RE = /queryId:\s*"([A-Za-z0-9_-]{10,40})",\s*operationName:\s*"AboutAccountQuery"/;

async function discover(urls: string[]): Promise<string | null> {
  const list = (urls || []).filter((u: string) => /^https:\/\/abs\.twimg\.com\/responsive-web\//.test(u)).slice(0, 60);
  for (const u of list) {
    try {
      const res = await fetch(u, { credentials: 'omit' });
      if (!res.ok) continue;
      const m = RE.exec(await res.text());
      if (m) return m[1];
    } catch (_) { /* try next */ }
  }
  return null;
}

// ---------------- investigations ----------------
async function runInvestigation(raw: unknown) {
  const parsed = AccountObservation.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'observation rejected: ' + parsed.error.issues.slice(0, 3).map(i => i.path.join('.') + ' ' + i.message).join('; ') };
  const obs = parsed.data;
  const id = investigationId(obs.handle);
  const prev = await loadInvestigation(chrome.storage.local, id);
  const inv = upsertInvestigation(prev, obs);
  await saveInvestigation(chrome.storage.local, inv);
  return { ok: true, id, version: inv.currentVersion };
}

function openPanel(sender: any, id: string) {
  // Must be called synchronously inside the message handler to keep the user gesture.
  const tabId = sender && sender.tab && sender.tab.id;
  if (chrome.sidePanel && chrome.sidePanel.open && tabId != null) {
    return chrome.sidePanel.open({ tabId }).then(() => true, () => false);
  }
  return Promise.resolve(false);
}

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg: any, sender: any, sendResponse: (r: any) => void) => {
  // Only accept messages from this extension's own pages / content scripts.
  if (sender.id !== chrome.runtime.id) return false;
  if (msg && msg.type === 'investigate') {
    const handle = msg.observation && typeof msg.observation.handle === 'string' ? msg.observation.handle : '';
    const opened = openPanel(sender, handle);
    chrome.storage.local.set({ [ACTIVE_KEY + ':pending']: { handle, at: Date.now() } });
    runInvestigation(msg.observation).then(async r => {
      if (r.ok && !(await opened) && chrome.tabs && chrome.tabs.create) {
        // Side panel unavailable (older Brave/Chromium): open the same workspace in a tab.
        chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel.html?inv=' + r.id) });
      }
      sendResponse(r);
    }, (e: any) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (msg && msg.type === 'reinvestigate') {
    // From the side panel: ask the active X tab for a fresh observation of this handle.
    if (!chrome.tabs || !chrome.tabs.query) { sendResponse({ ok: false, error: 'tabs API unavailable' }); return false; }
    chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] }).then(async (tabs: any[]) => {
      const t = tabs.find(x => x.active) || tabs[0];
      if (!t) return sendResponse({ ok: false, error: 'Open X in a tab to refresh.' });
      try {
        const obs = await chrome.tabs.sendMessage(t.id, { type: 'observe', handle: msg.handle });
        if (!obs || !obs.ok) return sendResponse({ ok: false, error: (obs && obs.error) || 'no observation' });
        sendResponse(await runInvestigation(obs.observation));
      } catch (e: any) { sendResponse({ ok: false, error: 'Could not reach the X tab; reload it.' }); }
    });
    return true;
  }
  if (msg && msg.type === 'discoverQueryId') {
    discover(msg.urls).then(queryId => sendResponse({ queryId }));
    return true;
  }
  if (msg && msg.type === 'syncNow') {
    ensureAlarm();
    syncNow(true).then(sendResponse);
    return true;
  }
  return false;
});
