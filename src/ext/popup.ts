declare const chrome: any;
const $ = (id: string): any => document.getElementById(id);
export {};

async function refresh() {
  const all = await chrome.storage.local.get(null);
  const s = all.settings || {};
  $('enabled').checked = s.enabled !== false;
  const n = Object.keys(all).filter(k => k.startsWith('cf:h:')).length;
  const pause = all['cf:pauseUntil'] || 0;
  let msg = n + ' account' + (n === 1 ? '' : 's') + ' cached.';
  const d = new Date(); const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const daily = all['cf:daily'] && all['cf:daily'].day === today ? all['cf:daily'].count : 0;
  const cap = Number.isInteger(s.dailyCap) ? s.dailyCap : 300;
  msg += ' ' + (s.lookupMode === 'auto' ? 'Auto' : 'Careful') + ' mode \u00b7 ' + daily + '/' + cap + ' lookups today.';
  if (pause > Date.now()) msg += all['cf:pauseReason'] === 'daily'
    ? ' Paused: daily limit reached; resumes after midnight.'
    : ' Paused: rate-limited by X; resuming in ~' + Math.ceil((pause - Date.now()) / 60e3) + ' min.';
  $('status').textContent = msg;
  const sync = $('sync');
  if (!all.syncUrl) { sync.textContent = ''; }
  else if (all.syncState && all.syncState.error) { sync.textContent = 'Sync error: ' + all.syncState.error; sync.className = 'err'; }
  else if (all.syncState && all.syncState.lastSync) { sync.textContent = 'Synced from bot: ' + new Date(all.syncState.lastSync).toLocaleString(); sync.className = 'good'; }
  else { sync.textContent = 'Waiting for first sync from bot\u2026'; sync.className = ''; }
}

$('enabled').addEventListener('change', async (e: any) => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  settings.enabled = e.target.checked;
  await chrome.storage.local.set({ settings });
});

$('clear').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('cf:h:'));
  await chrome.storage.local.remove(keys);
  await chrome.storage.local.set({ 'cf:cacheCleared': Date.now() });
  $('status').textContent = 'Cleared ' + keys.length + ' cached accounts. Reload X to re-check.';
});

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('panel').addEventListener('click', async () => {
  // Open the investigations workspace for this window (falls back to a tab).
  try { const w = await chrome.windows.getCurrent(); await chrome.sidePanel.open({ windowId: w.id }); window.close(); }
  catch (_) { chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel.html') }); }
});
refresh();
