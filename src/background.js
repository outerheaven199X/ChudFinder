/* Chud Finder - service worker.
 * 1) Settings sync: if the user set a "Settings source URL" (https only), fetch it on
 *    startup and every 10 minutes, validate it strictly (data only, never executed),
 *    and apply it when its content changes.
 * 2) Query-id discovery: when the AboutAccountQuery id stops working, read X's own
 *    client JS bundles (already loaded by the page) to find the current id.
 */
'use strict';
importScripts('countries.js', 'lib.js', 'settings-schema.js');

const S = self.CFSettings;
const DEFAULTS = self.CFLib.DEFAULT_SETTINGS;
const ALARM = 'cf-settings-sync';
const PERIOD_MIN = 10;

// ---------------- settings sync ----------------
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function setState(patch) {
  const { syncState = {} } = await chrome.storage.local.get('syncState');
  await chrome.storage.local.set({ syncState: Object.assign(syncState, patch, { lastChecked: Date.now() }) });
}

let syncing = null;
function syncNow(force) {
  if (!syncing) syncing = doSync(force).finally(() => { syncing = null; });
  return syncing;
}

async function doSync(force) {
  const { syncUrl, syncState = {} } = await chrome.storage.local.get(['syncUrl', 'syncState']);
  if (!syncUrl) return { ok: true, skipped: true };
  const u = S.checkSourceUrl(syncUrl);
  if (!u) { await setState({ error: 'Settings source URL must be https.' }); return { ok: false }; }

  const origin = u.origin + '/*';
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    await setState({ error: 'Permission to read ' + u.host + ' was not granted. Save the URL again in Settings.' });
    return { ok: false };
  }

  let text;
  try {
    const res = await fetch(u.href, { cache: 'no-store', credentials: 'omit', redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (res.url && !res.url.startsWith('https:')) throw new Error('redirected to a non-https URL');
    const len = Number(res.headers.get('content-length') || 0);
    if (len > S.MAX_BYTES) throw new Error('document larger than 64 KB');
    text = await res.text();
  } catch (e) {
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

chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) syncNow(false); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); syncNow(false); });

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) await chrome.storage.local.set({ settings: Object.assign({}, DEFAULTS, { highlightCountries: [] }) });
  await ensureAlarm();
  syncNow(false);
});

// ---------------- query-id discovery ----------------
const RE = /queryId:\s*"([A-Za-z0-9_-]{10,40})",\s*operationName:\s*"AboutAccountQuery"/;

async function discover(urls) {
  const list = (urls || []).filter(u => /^https:\/\/abs\.twimg\.com\/responsive-web\//.test(u)).slice(0, 60);
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from this extension's own pages / content scripts.
  if (sender.id !== chrome.runtime.id) return false;
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
