/* Lightweight selection UI. No network, cookies, page bridge or passive evidence collection. */
import { extractPost, handleFromUserName, parseRoute, SEL, ADAPTER_VERSION } from './xdom.ts';
import { DEFAULT_SETTINGS } from './lib.ts';
import { countryBadge } from './country-badge.ts';
import { AccountObservation } from '../shared/schemas.ts';
import { cleanText } from '../shared/sanitize.ts';
import { investigationId } from '../shared/engine.ts';
declare const chrome: any;
let settings = { ...DEFAULT_SETTINGS };
const mounted = new WeakMap<Element, {handle:string; button:HTMLButtonElement}>();
const badges = new Map<string, ReturnType<typeof countryBadge>>();
const pending = new Map<string, Promise<void>>();
const generations = new Map<string, number>();
function loadBadge(handle: string) {
  const h = handle.toLowerCase();
  if (badges.has(h) || pending.has(h)) return;
  const key = 'cf:inv:' + investigationId(h), generation = generations.get(h) || 0;
  pending.set(h, chrome.storage.local.get(key).then(g => {
    if ((generations.get(h) || 0) === generation) badges.set(h, countryBadge(g[key],h));
  }).catch(() => badges.set(h,countryBadge(null,h))).finally(() => {pending.delete(h);schedule();}));
}
function paint(button: HTMLButtonElement, handle: string, profile = false) {
  const value = badges.get(handle.toLowerCase()) || countryBadge(null,handle);
  const label = value.flag + (value.name && settings.showName ? ' ' + value.name : '') +
    (value.warning && settings.vpnWarnings ? ' ⚠' : '') + (profile ? ' / @' + handle : '');
  const signature = JSON.stringify([label,value.detail]);
  if (button.dataset.cfDisplay === signature) return;
  button.dataset.cfDisplay = signature;
  button.className = 'cf-badge cf-ask' + (value.name ? '' : ' cf-unknown');
  button.textContent = label;
  button.title = value.detail;
  button.setAttribute('aria-label','Investigate @' + handle + ': ' + (value.name || 'country unavailable'));
}
function observation(handle: string, article: Element | null) {
  const now = new Date().toISOString(),
    candidate = article ? extractPost(article) : null;
  const post = candidate?.handle.toLowerCase() === handle.toLowerCase() ? candidate : null;
  const route = parseRoute(location.href);
  const profile =
    route?.handle?.toLowerCase() === handle.toLowerCase()
      ? document.querySelector('[data-testid="UserLocation"]')?.textContent
      : null;
  return AccountObservation.parse({
    handle,
    observedAt: now,
    pageUrl: 'https://x.com/' + handle,
    adapterVersion: ADAPTER_VERSION,
    about: null,
    profileLocation: profile ? { text: cleanText(profile, 120), observedAt: now } : null,
    posts: post ? [post] : [],
    focusPostId: post?.id || null,
    provider: 'UserEvidenceProvider',
  });
}
function select(anchor: HTMLElement, handle: string, article: Element | null) {
  // Send within the click gesture so the browser can open the side panel directly.
  chrome.runtime.sendMessage({type:'investigate',observation:observation(handle,article)})
    .then(r => {if (!r?.ok) anchor.title = r?.error || 'Investigation failed';})
    .catch(() => {anchor.title = 'Extension updated. Reload this X tab to investigate.';});
}
function scan() {
  if (!settings.enabled) return;
  for (const block of document.querySelectorAll(SEL.userName)) {
    const handle = handleFromUserName(block);
    if (!handle) continue;
    const existing = mounted.get(block);
    loadBadge(handle);
    if (existing?.handle === handle && existing.button.isConnected) {
      paint(existing.button,handle);
      continue;
    }
    existing?.button.remove();
    const b = document.createElement('button');
    b.type = 'button';
    paint(b,handle);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      select(b, handle, block.closest(SEL.article));
    });
    block.appendChild(b);
    mounted.set(block,{handle,button:b});
  }
  const route = parseRoute(location.href);
  let button = document.getElementById('cf-profile-select');
  if (route?.handle) {
    if (!button) {
      button = document.createElement('button');
      button.id = 'cf-profile-select';
      button.className = 'cf-badge';
      button.style.cssText = 'position:fixed;right:18px;bottom:24px;z-index:1000';
      document.body.appendChild(button);
    }
    loadBadge(route.handle);
    paint(button as HTMLButtonElement,route.handle,true);
    const h = route.handle;
    button.onclick = () => select(button!, h, null);
  } else button?.remove();
}
let scheduled = false;
function schedule() {
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }
}
const observer = new MutationObserver(schedule);
chrome.storage.local.get('settings').then((g) => {
  settings = { ...settings, ...g.settings };
  scan();
  observer.observe(document.body, { childList: true, subtree: true });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, change] of Object.entries(changes) as [string,any][]) {
    if (!key.startsWith('cf:inv:')) continue;
    const handle = change.newValue?.subject?.handle || change.oldValue?.subject?.handle;
    if (typeof handle !== 'string') continue;
    const h = handle.toLowerCase();
    if (key !== 'cf:inv:' + investigationId(h)) continue;
    generations.set(h,(generations.get(h) || 0)+1);
    badges.set(h,countryBadge(change.newValue,h));
    schedule();
  }
  if (area === 'local' && changes.settings) {
    settings = { ...settings, ...changes.settings.newValue };
    if (!settings.enabled) for (const b of document.querySelectorAll('.cf-badge')) b.remove();
    else scan();
  }
});
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== 'observe') return false;
  const route = parseRoute(location.href);
  if (route?.handle?.toLowerCase() !== String(msg.handle).toLowerCase()) {
    reply({ ok: false, error: 'Select this account on X to refresh its visible observation.' });
    return false;
  }
  const article = route.statusId
    ? [...document.querySelectorAll(SEL.article)].find(
        (a) => extractPost(a)?.id === route.statusId,
      ) || null
    : null;
  reply({ ok: true, observation: observation(msg.handle, article) });
  return false;
});
