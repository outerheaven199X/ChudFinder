export const X_PAGES = ['https://x.com/*', 'https://twitter.com/*'];

/** Activate existing X documents as well as future navigations. No toolbar gesture. */
export async function activateOpenXTabs(chrome: any) {
  const version = chrome.runtime.getManifest().version;
  const tabs = await chrome.tabs.query({ url: X_PAGES });
  const results: { tabId: number; status: string; error?: string }[] = [];
  for (const tab of tabs) {
    if (tab.id == null || !tab.url) continue;
    const url = new URL(tab.url);
    if (url.protocol !== 'https:' || !['x.com', 'twitter.com'].includes(url.hostname)) continue;
    if (new URLSearchParams(url.hash.slice(1)).has('cf-country-read')) continue;
    try {
      const ready = await chrome.tabs.sendMessage(tab.id, { type: 'cf-content-ready' }).catch(() => null);
      if (ready?.version === version && ready?.active) {
        results.push({ tabId: tab.id, status: 'already_active' });
        continue;
      }
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          // Releases before 3.2.1 cannot dispose their invalidated observers.
          legacy: !!document.querySelector('.cf-badge') && !document.documentElement.dataset.cfContentVersion,
          editing: [...document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea,input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])')].some(e => !!e.value.trim()) ||
            [...document.querySelectorAll('[contenteditable=true]')].some(e => !!e.textContent?.trim()),
        }),
      });
      if (result?.legacy) {
        if (result.editing) results.push({ tabId: tab.id, status: 'deferred_edit_in_progress' });
        else { await chrome.tabs.reload(tab.id); results.push({ tabId: tab.id, status: 'legacy_tab_refreshed' }); }
        continue;
      }
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['src/content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
      results.push({ tabId: tab.id, status: 'activated' });
    } catch (error: any) {
      // One closed/restricted tab must not prevent other open X pages from starting.
      results.push({ tabId: tab.id, status: 'failed', error: String(error.message).slice(0, 200) });
    }
  }
  await chrome.storage.local.set({ 'cf:activation': { version, at: Date.now(), results } });
  return results;
}
