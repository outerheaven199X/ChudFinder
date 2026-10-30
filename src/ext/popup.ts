declare const chrome: any;
const $ = (id: string): any => document.getElementById(id);
export {};

async function refresh() {
  const all = await chrome.storage.local.get(null);
  const s = all.settings || {};
  $('enabled').checked = s.enabled !== false;
  const n = (all['cf:invIndex'] || []).length;
  $('lookupMode').value = all['cf:lookupV32'] ? s.lookupMode || 'auto' : 'auto';
  const msg = n + ' investigations. Auto reads visible accounts; Careful reads on hover/click. One temporary X tab, no API credits.';
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
$('lookupMode').addEventListener('change',async(e:any)=>{
  const {settings={}}=await chrome.storage.local.get('settings');
  await chrome.storage.local.set({settings:{...settings,lookupMode:e.target.value},'cf:lookupV32':true});
});

$('clear').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('cf:h:') || k.startsWith('cf:country:'));
  await chrome.storage.local.remove(keys);
  await chrome.storage.local.set({ 'cf:cacheCleared': Date.now() });
  $('status').textContent = 'Cleared ' + keys.length + ' cached accounts. Countries will reload; investigation history is retained.';
});

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('panel').addEventListener('click', async () => {
  // Open the investigations workspace for this window (falls back to a tab).
  try { const w = await chrome.windows.getCurrent(); await chrome.sidePanel.open({ windowId: w.id }); window.close(); }
  catch (_) { chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel.html') }); }
});
refresh();
