/* Chud Finder - content script (isolated world) on x.com / twitter.com.
 * Watches the timeline, looks up each author's "Account based in" country via
 * X's own AboutAccountQuery (same-origin, using the logged-in session), caches
 * results, and renders a badge next to the author name.
 */
(function () {
  'use strict';
  const L = globalThis.CFLib;

  // ---- constants -----------------------------------------------------------
  const DEFAULT_QUERY_ID = 'XRqGa7EeokUU5kppkh13EA'; // AboutAccountQuery, as used by the X web client (Oct 2026)
  // Public bearer token embedded in X's web client JS (same for every user). Replaced
  // automatically by the one the page actually uses once page.js observes a request.
  const DEFAULT_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const CACHE_PREFIX = 'cf:h:';
  const TTL_FOUND = 24 * 3600e3;
  const TTL_EMPTY = 6 * 3600e3;
  const MIN_GAP_MS = 1500;          // at most ~40 lookups/minute
  const DEFAULT_BACKOFF_MS = 15 * 60e3;
  const PAUSE_KEY = 'cf:pauseUntil';

  // ---- state ---------------------------------------------------------------
  let settings = Object.assign({}, L.DEFAULT_SETTINGS);
  let bearer = DEFAULT_BEARER;
  let queryId = DEFAULT_QUERY_ID;
  let pauseUntil = 0;
  const mem = new Map();            // handle(lower) -> {basedIn, accurate, source, notFound, t}
  const inflight = new Map();       // handle(lower) -> Promise
  const queue = [];                 // handles waiting for a lookup
  const queued = new Set();
  const stated = new Map();         // handle(lower) -> self-reported profile location
  let pumping = false;
  let lastRequestAt = 0;

  const ext = typeof chrome !== 'undefined' && chrome.storage ? chrome : null;

  // ---- messages from page.js (MAIN world) ----------------------------------
  window.addEventListener('message', ev => {
    if (ev.source !== window || !ev.data || ev.data.__chudFinder !== true) return;
    const { type, payload } = ev.data;
    if (type === 'auth' && typeof payload === 'string' && /^Bearer [A-Za-z0-9%_-]+$/.test(payload)) bearer = payload;
    else if (type === 'queryId' && /^[A-Za-z0-9_-]{10,40}$/.test(payload)) {
      queryId = payload; ext && ext.storage.local.set({ 'cf:queryId': payload });
    } else if (type === 'locations' && payload && typeof payload === 'object') {
      for (const [h, loc] of Object.entries(payload)) {
        if (typeof loc !== 'string') continue;
        const prev = stated.get(h);
        stated.set(h, loc.slice(0, 120));
        if (prev !== stated.get(h) && mem.has(h)) rerenderHandle(h);
      }
    }
  });

  // ---- cache ---------------------------------------------------------------
  function fresh(rec) {
    if (!rec || !rec.t) return false;
    return Date.now() - rec.t < (rec.basedIn ? TTL_FOUND : TTL_EMPTY);
  }

  async function cacheGet(h) {
    const m = mem.get(h);
    if (fresh(m)) return m;
    if (!ext) return null;
    const key = CACHE_PREFIX + h;
    const got = await ext.storage.local.get(key);
    const rec = got[key];
    if (fresh(rec)) { mem.set(h, rec); return rec; }
    if (rec) ext.storage.local.remove(key);
    return null;
  }

  function cacheSet(h, rec) {
    rec.t = Date.now();
    mem.set(h, rec);
    if (ext) ext.storage.local.set({ [CACHE_PREFIX + h]: rec });
  }

  // ---- network -------------------------------------------------------------
  function csrf() {
    const m = /(?:^|;\s*)ct0=([^;]+)/.exec(document.cookie);
    return m ? decodeURIComponent(m[1]) : null;
  }

  class RateLimited extends Error {
    constructor(until) { super('rate limited'); this.until = until; }
  }

  async function fetchAbout(handle) {
    const token = csrf();
    if (!token) throw new Error('not logged in (no ct0 cookie)');
    const vars = encodeURIComponent(JSON.stringify({ screenName: handle }));
    const url = location.origin + '/i/api/graphql/' + queryId + '/AboutAccountQuery?variables=' + vars;
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        authorization: bearer,
        'x-csrf-token': token,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'content-type': 'application/json'
      }
    });
    if (res.status === 429) {
      const reset = Number(res.headers.get('x-rate-limit-reset')) * 1000;
      throw new RateLimited(reset > Date.now() ? reset + 5000 : Date.now() + DEFAULT_BACKOFF_MS);
    }
    if (res.status === 404 || res.status === 400) {
      // Likely a rotated query id - ask the background worker to rediscover it once.
      const fresh = await discoverQueryId();
      if (fresh && fresh !== queryId) { queryId = fresh; return fetchAbout(handle); }
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return L.parseAbout(json, handle);
  }

  let discovering = null;
  function discoverQueryId() {
    if (!ext || !ext.runtime) return Promise.resolve(null);
    if (discovering) return discovering;
    const urls = performance.getEntriesByType('resource').map(e => e.name)
      .filter(u => /^https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^/]*\/.+\.js$/.test(u));
    for (const s of document.scripts) if (s.src && /abs\.twimg\.com\/responsive-web\//.test(s.src)) urls.push(s.src);
    discovering = ext.runtime.sendMessage({ type: 'discoverQueryId', urls: [...new Set(urls)] })
      .then(r => {
        const id = r && r.queryId;
        if (id) ext.storage.local.set({ 'cf:queryId': id });
        return id || null;
      })
      .catch(() => null);
    return discovering;
  }

  function lookup(h) {
    if (inflight.has(h)) return inflight.get(h);
    const p = (async () => {
      const c = await cacheGet(h);
      if (c) return c;
      return new Promise((resolve, reject) => {
        enqueue(h, resolve, reject);
      });
    })().finally(() => inflight.delete(h));
    inflight.set(h, p);
    return p;
  }

  const waiters = new Map(); // h -> [{resolve, reject}]
  function enqueue(h, resolve, reject) {
    if (!waiters.has(h)) waiters.set(h, []);
    waiters.get(h).push({ resolve, reject });
    if (!queued.has(h)) { queued.add(h); queue.push(h); }
    pump();
  }

  function settle(h, fn) {
    for (const w of waiters.get(h) || []) fn(w);
    waiters.delete(h);
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length && settings.enabled) {
        if (Date.now() < pauseUntil) { await sleep(Math.min(pauseUntil - Date.now(), 60e3)); continue; }
        const wait = lastRequestAt + MIN_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        // Most recently seen handles first: they are what the user is looking at.
        const h = queue.pop();
        queued.delete(h);
        lastRequestAt = Date.now();
        try {
          const rec = await fetchAbout(h);
          cacheSet(h, rec);
          settle(h, w => w.resolve(rec));
        } catch (e) {
          if (e instanceof RateLimited) {
            setPause(e.until);
            queue.push(h); queued.add(h); // retry after the pause
            setPendingTitle();
          } else {
            settle(h, w => w.reject(e));
          }
        }
      }
    } finally {
      pumping = false;
    }
  }

  function setPause(until) {
    pauseUntil = Math.max(pauseUntil, until);
    if (ext) ext.storage.local.set({ [PAUSE_KEY]: pauseUntil });
  }

  function setPendingTitle() {
    const mins = Math.max(1, Math.round((pauseUntil - Date.now()) / 60e3));
    for (const el of document.querySelectorAll('.cf-badge.cf-pending')) {
      el.title = 'Chud Finder: X rate limit reached; lookups resume in ~' + mins + ' min.';
    }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- rendering -----------------------------------------------------------
  function place(block, badge) {
    const old = block.querySelector(':scope [data-cf-badge]');
    if (old) { old.replaceWith(badge); return; }
    const row = block.firstElementChild || block;
    row.appendChild(badge);
  }

  function draw(block, h, info) {
    if (!settings.enabled) return;
    const badge = L.renderBadge(document, info, settings, stated.get(h.toLowerCase()) || '', h);
    place(block, badge);
  }

  function rerenderHandle(h) {
    for (const block of document.querySelectorAll('[data-cf-handle="' + CSS.escape(h) + '"]')) {
      draw(block, h, mem.get(h));
    }
  }

  function rerenderAll() {
    for (const block of document.querySelectorAll('[data-cf-handle]')) {
      const h = block.getAttribute('data-cf-handle');
      const rec = mem.get(h);
      if (rec) draw(block, h, rec);
    }
  }

  function removeAll() {
    for (const el of document.querySelectorAll('[data-cf-badge]')) el.remove();
    for (const el of document.querySelectorAll('[data-cf-handle]')) el.removeAttribute('data-cf-handle');
  }

  function processBlock(block, handle) {
    const h = handle.toLowerCase();
    if (block.getAttribute('data-cf-handle') === h && block.querySelector('[data-cf-badge]')) return;
    block.setAttribute('data-cf-handle', h);
    const known = mem.get(h);
    if (fresh(known)) { draw(block, h, known); return; }
    draw(block, h, { pending: true });
    lookup(h).then(rec => draw(block, h, rec), err => draw(block, h, { error: String(err && err.message || err) }));
  }

  // Only look up authors of tweets that are (nearly) on screen.
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      for (const { block, handle } of L.extractAuthors(e.target)) processBlock(block, handle);
    }
  }, { rootMargin: '600px 0px' });

  function scan(root) {
    if (!settings.enabled) return;
    const scope = root && root.querySelectorAll ? root : document;
    const arts = scope.matches && scope.matches('article[data-testid="tweet"]') ? [scope]
      : scope.querySelectorAll('article[data-testid="tweet"]');
    for (const a of arts) {
      if (a.__cfObserved) {
        // Article reused by X's virtualised list - re-check authors directly.
        for (const { block, handle } of L.extractAuthors(a)) {
          if (block.getAttribute('data-cf-handle') !== handle.toLowerCase()) processBlock(block, handle);
        }
        continue;
      }
      a.__cfObserved = true;
      io.observe(a);
    }
  }

  let scheduled = false;
  const mo = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; scan(document); });
  });

  // ---- settings & lifecycle -------------------------------------------------
  async function init() {
    if (ext) {
      const got = await ext.storage.local.get(['settings', 'cf:queryId', PAUSE_KEY]);
      settings = Object.assign({}, L.DEFAULT_SETTINGS, got.settings || {});
      if (got['cf:queryId']) queryId = got['cf:queryId'];
      if (got[PAUSE_KEY]) pauseUntil = got[PAUSE_KEY];
      ext.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.settings) {
          const was = settings.enabled;
          settings = Object.assign({}, L.DEFAULT_SETTINGS, changes.settings.newValue || {});
          if (!settings.enabled) removeAll();
          else if (!was) { document.querySelectorAll('article[data-testid="tweet"]').forEach(a => { a.__cfObserved = false; }); scan(document); pump(); }
          else rerenderAll();
        }
        if (changes[PAUSE_KEY]) pauseUntil = Math.max(pauseUntil, changes[PAUSE_KEY].newValue || 0);
        if (changes['cf:cacheCleared']) { mem.clear(); }
      });
    }
    mo.observe(document.documentElement, { childList: true, subtree: true });
    scan(document);
  }

  init();
})();
