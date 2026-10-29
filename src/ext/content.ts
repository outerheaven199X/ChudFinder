/* Lightweight selection UI. No network, cookies, page bridge or passive evidence collection. */
import { extractPost, handleFromUserName, parseRoute, SEL, ADAPTER_VERSION } from './xdom.ts';
import { openPopover } from './popover.ts';
import { DEFAULT_SETTINGS } from './lib.ts';
import { AccountObservation } from '../shared/schemas.ts';
import { cleanText } from '../shared/sanitize.ts';
import { investigationId } from '../shared/engine.ts';
declare const chrome: any;
let settings = { ...DEFAULT_SETTINGS };
const mounted = new WeakSet<Element>();
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
async function select(anchor: HTMLElement, handle: string, article: Element | null) {
  const key = 'cf:inv:' + investigationId(handle),
    stored = (await chrome.storage.local.get(key))[key];
  const snapshot = stored?.snapshots?.find((s: any) => s.version === stored.currentVersion),
    account = snapshot?.account;
  const trustworthy =
    account &&
    stored.evidence?.some(
      (e: any) =>
        snapshot.evidenceIds.includes(e.id) &&
        e.kind === 'about_based_in' &&
        e.provenance === 'user_captured',
    );
  const info = trustworthy
    ? {
        basedIn: account.basedIn,
        source: account.connectedVia,
        accurate: account.locationAccurate,
        t: Date.parse(account.aboutObservedAt),
      }
    : null;
  openPopover(document, anchor, {
    handle,
    info,
    statedLocation: account?.profileLocation || '',
    evaluation: {
      known: !!info?.basedIn,
      name: info?.basedIn || null,
      isRegion: !!account?.basedInIsRegion,
      warnings: [],
      flag: '',
    },
    askGrok: false,
    onAskGrok: () => {},
    onInvestigate: () => {
      chrome.runtime
        .sendMessage({ type: 'investigate', observation: observation(handle, article) })
        .then((r) => {
          if (!r?.ok) anchor.title = r?.error || 'Investigation failed';
        });
    },
  });
}
function scan() {
  if (!settings.enabled) return;
  for (const block of document.querySelectorAll(SEL.userName)) {
    if (mounted.has(block) && block.querySelector('.cf-badge')) continue;
    const handle = handleFromUserName(block);
    if (!handle) continue;
    mounted.add(block);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cf-badge';
    b.textContent = 'CF';
    b.title = 'Inspect public evidence for @' + handle;
    b.setAttribute('aria-label', 'Investigate @' + handle);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      select(b, handle, block.closest(SEL.article));
    });
    block.appendChild(b);
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
    button.textContent = 'CF / @' + route.handle;
    const h = route.handle;
    button.onclick = () => select(button!, h, null);
  } else button?.remove();
}
let scheduled = false;
const observer = new MutationObserver(() => {
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }
});
chrome.storage.local.get('settings').then((g) => {
  settings = { ...settings, ...g.settings };
  scan();
  observer.observe(document.body, { childList: true, subtree: true });
});
chrome.storage.onChanged.addListener((changes, area) => {
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
