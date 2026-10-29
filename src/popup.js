'use strict';
const $ = id => document.getElementById(id);

async function refresh() {
  const all = await chrome.storage.local.get(null);
  const s = all.settings || {};
  $('enabled').checked = s.enabled !== false;
  const n = Object.keys(all).filter(k => k.startsWith('cf:h:')).length;
  const pause = all['cf:pauseUntil'] || 0;
  let msg = n + ' account' + (n === 1 ? '' : 's') + ' cached.';
  if (pause > Date.now()) msg += ' Rate-limited by X; resuming in ~' + Math.ceil((pause - Date.now()) / 60e3) + ' min.';
  $('status').textContent = msg;
  const sync = $('sync');
  if (!all.syncUrl) { sync.textContent = ''; }
  else if (all.syncState && all.syncState.error) { sync.textContent = 'Sync error: ' + all.syncState.error; sync.className = 'err'; }
  else if (all.syncState && all.syncState.lastSync) { sync.textContent = 'Synced from bot: ' + new Date(all.syncState.lastSync).toLocaleString(); sync.className = 'good'; }
  else { sync.textContent = 'Waiting for first sync from bot\u2026'; sync.className = ''; }
}

$('enabled').addEventListener('change', async e => {
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
refresh();
