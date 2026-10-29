/* Chud Finder - content script (isolated world) on x.com / twitter.com.
 * Watches the timeline, looks up each author's "Account based in" country via
 * X's own AboutAccountQuery (same-origin, using the logged-in session), caches
 * results, and renders a badge next to the author name.
 */
import * as L from './lib.ts';
import type { AboutInfo } from './lib.ts';
import { ADAPTER_VERSION, extractPost, parseRoute, postsOnPage } from './xdom.ts';
import { openPopover, closePopover } from './popover.ts';
import { topicSignal } from '../shared/topics.ts';
import { DEFAULT_PACING, HOVER_INTENT_MS, jitterGap, waitBeforeNext, capReached, bumpDaily, currentDaily, nextLocalMidnight, clampDailyCap } from '../shared/pacing.ts';
import type { DailyState } from '../shared/pacing.ts';
import { extractPost as cfExtractPost, SEL as CF_SEL } from './xdom.ts';
import { AccountObservation, Post } from '../shared/schemas.ts';
import { cleanText, safeHttpsUrl } from '../shared/sanitize.ts';

declare const chrome: any;

(function () {
  'use strict';
  type Rec = AboutInfo & { t?: number };

  // ---- constants -----------------------------------------------------------
  const DEFAULT_QUERY_ID = 'XRqGa7EeokUU5kppkh13EA'; // AboutAccountQuery, as used by the X web client (Oct 2026)
  // Public bearer token embedded in X's web client JS (same for every user). Replaced
  // automatically by the one the page actually uses once page.js observes a request.
  const DEFAULT_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const CACHE_PREFIX = 'cf:h:';
  const TTL_FOUND = 24 * 3600e3;
  const TTL_EMPTY = 6 * 3600e3;
  const DEFAULT_BACKOFF_MS = 15 * 60e3;
  const PAUSE_KEY = 'cf:pauseUntil';
  const PAUSE_REASON_KEY = 'cf:pauseReason';   // 'rate' (X said 429) | 'daily' (daily cap reached)
  const DAILY_KEY = 'cf:daily';                // { day: 'YYYY-MM-DD' (local), count }
  // Test-only override; the page cannot reach the content script's isolated world.
  const P = Object.assign({}, DEFAULT_PACING, (window as any).__CF_PACING__ || {});
  const HOVER_MS = (window as any).__CF_PACING__?.hoverMs ?? HOVER_INTENT_MS;

  // ---- state ---------------------------------------------------------------
  let settings: L.Settings = Object.assign({}, L.DEFAULT_SETTINGS) as L.Settings;
  let bearer = DEFAULT_BEARER;
  let queryId = DEFAULT_QUERY_ID;
  let pauseUntil = 0;
  let pauseReason: 'rate' | 'daily' = 'rate';
  let dailyMem: DailyState | null = null;     // used when chrome.storage is unavailable
  const recent: number[] = [];                // request timestamps (last minute)
  const mem = new Map<string, Rec>();            // handle(lower) -> {basedIn, accurate, source, notFound, t}
  const inflight = new Map<string, Promise<Rec>>(); // handle(lower) -> Promise
  const queue: string[] = [];                    // handles waiting for a passive (auto-mode) lookup
  const intentQueue: string[] = [];              // handles the user asked about (hover, click, popover, Investigate)
  const queued = new Set<string>();
  const stated = new Map<string, string>();      // handle(lower) -> self-reported profile location
  const statedAt = new Map<string, number>();    // handle(lower) -> when it was seen
  const seenPosts = new Map<string, any[]>();    // handle(lower) -> recent posts from X's own timeline responses
  const MAX_POSTS_PER_HANDLE = 100;
  let pumping = false;

  const ext = typeof chrome !== 'undefined' && chrome.storage ? chrome : null;

  // ---- messages from page.js (MAIN world) ----------------------------------
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window || !ev.data || ev.data.__chudFinder !== true) return;
    const { type, payload } = ev.data;
    if (type === 'auth' && typeof payload === 'string' && /^Bearer [A-Za-z0-9%_-]+$/.test(payload)) bearer = payload;
    else if (type === 'queryId' && /^[A-Za-z0-9_-]{10,40}$/.test(payload)) {
      queryId = payload; ext && ext.storage.local.set({ 'cf:queryId': payload });
    } else if (type === 'locations' && payload && typeof payload === 'object') {
      for (const [h, loc] of Object.entries(payload)) {
        if (typeof loc !== 'string') continue;
        const prev = stated.get(h);
        stated.set(h, loc.slice(0, 120)); statedAt.set(h, Date.now());
        if (prev !== stated.get(h) && mem.has(h)) rerenderHandle(h);
      }
    } else if (type === 'posts' && Array.isArray(payload)) {
      for (const p of payload.slice(0, 200)) {
        if (!p || typeof p.handle !== 'string' || typeof p.id !== 'string') continue;
        const h = p.handle.toLowerCase();
        const list = seenPosts.get(h) || [];
        if (!list.some(x => x.id === p.id)) { list.push(p); if (list.length > MAX_POSTS_PER_HANDLE) list.shift(); }
        seenPosts.set(h, list);
      }
    }
  });

  // ---- cache ---------------------------------------------------------------
  function fresh(rec: Rec | null | undefined): boolean {
    if (!rec || !rec.t) return false;
    return Date.now() - rec.t < (rec.basedIn ? TTL_FOUND : TTL_EMPTY);
  }

  async function cacheGet(h: string): Promise<Rec | null> {
    const m = mem.get(h);
    if (fresh(m)) return m!;
    if (!ext) return null;
    const key = CACHE_PREFIX + h;
    const got = await ext.storage.local.get(key);
    const rec = got[key];
    if (fresh(rec)) { mem.set(h, rec); return rec; }
    if (rec) ext.storage.local.remove(key);
    return null;
  }

  function cacheSet(h: string, rec: Rec) {
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
    until: number;
    constructor(until: number) { super('rate limited'); this.until = until; }
  }

  async function fetchAbout(handle: string): Promise<Rec> {
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

  let discovering: Promise<string | null> | null = null;
  function discoverQueryId(): Promise<string | null> {
    if (!ext || !ext.runtime) return Promise.resolve(null);
    if (discovering) return discovering;
    const urls = performance.getEntriesByType('resource').map(e => e.name)
      .filter(u => /^https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^/]*\/.+\.js$/.test(u));
    for (const s of Array.from(document.scripts)) if (s.src && /abs\.twimg\.com\/responsive-web\//.test(s.src)) urls.push(s.src);
    discovering = ext.runtime.sendMessage({ type: 'discoverQueryId', urls: [...new Set(urls)] })
      .then((r: any) => {
        const id = r && r.queryId;
        if (id) ext.storage.local.set({ 'cf:queryId': id });
        return id || null;
      })
      .catch(() => null);
    return discovering!;
  }

  function lookup(h: string, intent = false): Promise<Rec> {
    if (intent && queued.has(h) && !intentQueue.includes(h)) {
      const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1);
      intentQueue.push(h); pump();
    }
    if (inflight.has(h)) return inflight.get(h)!;
    const p = (async () => {
      const c = await cacheGet(h);
      if (c) return c;
      return new Promise<Rec>((resolve, reject) => {
        enqueue(h, resolve, reject, intent);
      });
    })().finally(() => inflight.delete(h));
    inflight.set(h, p);
    return p;
  }

  const waiters = new Map<string, { resolve: (r: Rec) => void; reject: (e: unknown) => void }[]>(); // h -> [{resolve, reject}]
  function enqueue(h: string, resolve: (r: Rec) => void, reject: (e: unknown) => void, intent = false) {
    if (!waiters.has(h)) waiters.set(h, []);
    waiters.get(h)!.push({ resolve, reject });
    if (!queued.has(h)) { queued.add(h); (intent ? intentQueue : queue).push(h); }
    pump();
  }

  function settle(h: string, fn: (w: { resolve: (r: Rec) => void; reject: (e: unknown) => void }) => void) {
    for (const w of waiters.get(h) || []) fn(w);
    waiters.delete(h);
  }

  function waitVisible(): Promise<void> {
    return new Promise(r => {
      const on = () => { if (document.visibilityState !== 'hidden') { document.removeEventListener('visibilitychange', on); r(); } };
      document.addEventListener('visibilitychange', on);
    });
  }

  async function readDaily(): Promise<DailyState> {
    if (!ext) return currentDaily(dailyMem, Date.now());
    const got = await ext.storage.local.get(DAILY_KEY);
    return currentDaily(got[DAILY_KEY], Date.now());
  }
  async function writeDaily(st: DailyState) {
    dailyMem = st;
    if (ext) await ext.storage.local.set({ [DAILY_KEY]: st });
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while ((intentQueue.length || queue.length) && settings.enabled) {
        if (Date.now() < pauseUntil) { setPendingTitle(); await sleep(Math.min(pauseUntil - Date.now(), 60e3)); continue; }
        if (document.visibilityState === 'hidden') { await waitVisible(); continue; }   // never look up from a background tab
        const intent = intentQueue.length > 0;
        const wait = waitBeforeNext(intent ? 'intent' : 'passive', Date.now(), recent, intent ? 0 : jitterGap(P), P);
        if (wait > 0) {
          const until = Date.now() + wait; let preempt = false;
          while (Date.now() < until) {
            await sleep(Math.min(250, until - Date.now()));
            if (!intent && intentQueue.length) { preempt = true; break; }   // user intent jumps the passive queue
          }
          if (preempt) continue;
        }
        // Most recently requested handles first: they are what the user is looking at.
        const h = (intent ? intentQueue : queue).pop()!;
        queued.delete(h);
        // Another tab may have looked it up meanwhile (shared storage cache).
        const cached = await cacheGet(h);
        if (cached) { settle(h, w => w.resolve(cached)); continue; }
        const daily = await readDaily();
        if (capReached(daily, settings.dailyCap, Date.now())) {
          setPause(nextLocalMidnight(Date.now()), 'daily');
          (intent ? intentQueue : queue).push(h); queued.add(h);
          continue;
        }
        await writeDaily(bumpDaily(daily, Date.now()));
        const now = Date.now();
        recent.push(now); while (recent.length && recent[0] < now - 120e3) recent.shift();
        try {
          const rec = await fetchAbout(h);
          cacheSet(h, rec);
          settle(h, w => w.resolve(rec));
        } catch (e) {
          if (e instanceof RateLimited) {
            setPause(e.until, 'rate');
            (intent ? intentQueue : queue).push(h); queued.add(h); // retry after the pause
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

  function setPause(until: number, reason: 'rate' | 'daily' = 'rate') {
    if (until > pauseUntil) pauseReason = reason;
    pauseUntil = Math.max(pauseUntil, until);
    if (ext) ext.storage.local.set({ [PAUSE_KEY]: pauseUntil, [PAUSE_REASON_KEY]: pauseReason });
  }

  function setPendingTitle() {
    const mins = Math.max(1, Math.round((pauseUntil - Date.now()) / 60e3));
    for (const el of document.querySelectorAll('.cf-badge.cf-pending')) {
      (el as HTMLElement).title = pauseReason === 'daily'
        ? 'Chud Finder: daily lookup limit (' + clampDailyCap(settings.dailyCap) + ') reached; lookups resume after midnight. Cached accounts still show.'
        : 'Chud Finder: X rate limit reached; lookups resume in ~' + mins + ' min.';
    }
  }

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  // ---- rendering -----------------------------------------------------------
  function place(block: Element, badge: HTMLElement) {
    const old = block.querySelector(':scope [data-cf-badge]');
    if (old) { old.replaceWith(badge); return; }
    const row = block.firstElementChild || block;
    row.appendChild(badge);
  }

  function draw(block: Element, h: string, info: Rec) {
    if (!settings.enabled) return;
    const onActivate = settings.popover !== false ? activate : undefined;
    const badge = L.renderBadge(document, info, settings, stated.get(h.toLowerCase()) || '', h, onActivate);
    place(block, badge);
    if (info.idle) badge.addEventListener('click', () => { intentLookup(h.toLowerCase()).catch(() => {}); });
    drawTopic(block, h, info);
  }

  // Topic mode: neutral, inferred note when a post's topic tags don't match where X reports the account is based.
  function topicFor(article: Element | null, h: string, info: Rec | null | undefined) {
    if (!settings.topicMode || !article || !info || !info.basedIn) return null;
    const post = cfExtractPost(article);
    if (!post || post.handle.toLowerCase() !== h.toLowerCase()) return null;
    const ev = L.evaluate(info, settings, '');
    return topicSignal(post.text, ev.code, ev.name);
  }
  function drawTopic(block: Element, h: string, info: Rec) {
    const art = block.closest(CF_SEL.article);
    if (!art) return;
    const post = cfExtractPost(art);
    if (!post || post.handle.toLowerCase() !== h.toLowerCase()) return;   // quoted author: leave the main post's note alone
    const old = art.querySelector('[data-cf-topic]');
    const sig = topicFor(art, h, info);
    if (!sig) { if (old) old.remove(); return; }
    const note = L.renderTopicNote(document, sig);
    if (old) { old.replaceWith(note); return; }
    const text = art.querySelector(CF_SEL.tweetText);
    if (text) text.after(note);
  }

  function rerenderHandle(h: string) {
    for (const block of document.querySelectorAll('[data-cf-handle="' + CSS.escape(h) + '"]')) {
      draw(block, h, mem.get(h)!);
    }
  }

  function rerenderAll() {
    for (const block of document.querySelectorAll('[data-cf-handle]')) {
      const h = block.getAttribute('data-cf-handle')!;
      const rec = mem.get(h);
      if (rec) draw(block, h, rec);
    }
  }

  function removeAll() {
    for (const el of document.querySelectorAll('[data-cf-badge], [data-cf-topic]')) el.remove();
    for (const el of document.querySelectorAll('[data-cf-handle]')) el.removeAttribute('data-cf-handle');
  }

  function processBlock(block: Element, handle: string) {
    const h = handle.toLowerCase();
    if (block.getAttribute('data-cf-handle') === h && block.querySelector('[data-cf-badge]')) return;
    block.setAttribute('data-cf-handle', h);
    const known = mem.get(h);
    if (fresh(known)) { draw(block, h, known!); return; }
    if (settings.lookupMode !== 'auto') {
      // Careful mode: no network just because a handle scrolled into view. Show a neutral placeholder,
      // use any cached result (from any tab), and look up only on user intent.
      draw(block, h, { idle: true });
      armIntent(block, h);
      cacheGet(h).then(rec => { if (rec && block.getAttribute('data-cf-handle') === h) draw(block, h, rec); }, () => {});
      return;
    }
    draw(block, h, { pending: true });
    lookup(h).then(rec => draw(block, h, rec), err => draw(block, h, { error: String(err && err.message || err) }));
  }

  function blocksFor(h: string): Element[] {
    return [...document.querySelectorAll('[data-cf-handle="' + CSS.escape(h) + '"]')];
  }

  /** A user-intent lookup (hover, click, popover, Investigate). Resolves with the record. */
  function intentLookup(h: string): Promise<Rec> {
    const known = mem.get(h);
    if (fresh(known)) return Promise.resolve(known!);
    for (const b of blocksFor(h)) if (b.querySelector('[data-cf-badge].cf-idle')) draw(b, h, { pending: true });
    const p = lookup(h, true);
    p.then(rec => { for (const b of blocksFor(h)) draw(b, h, rec); },
      err => { for (const b of blocksFor(h)) draw(b, h, { error: String(err && err.message || err) }); });
    return p;
  }

  // Hovering the author name/handle/badge for ~600 ms counts as intent.
  function armIntent(block: Element, h: string) {
    const b: any = block;
    if (b.__cfArmed === h) return;
    b.__cfArmed = h;
    let timer: any = null;
    block.addEventListener('mouseenter', () => {
      if (timer || settings.lookupMode === 'auto') return;
      timer = setTimeout(() => { timer = null; const cur = block.getAttribute('data-cf-handle'); if (cur) intentLookup(cur).catch(() => {}); }, HOVER_MS);
    });
    block.addEventListener('mouseleave', () => { if (timer) { clearTimeout(timer); timer = null; } });
  }

  // Only look up authors of tweets that are (nearly) on screen.
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      for (const { block, handle } of L.extractAuthors(e.target)) processBlock(block, handle);
    }
  }, { rootMargin: '600px 0px' });

  function scan(root: any) {
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

  // ---- popover + investigate ------------------------------------------------
  function aboutObservation(rec: Rec | undefined) {
    if (!rec || rec.pending || rec.error || !rec.t) return null;
    return { basedIn: rec.basedIn ?? null, accurate: rec.accurate ?? null, source: rec.source ?? null, notFound: !!rec.notFound,
      observedAt: new Date(rec.t).toISOString() };
  }

  function graphqlPost(p: any): any | null {
    const d = Date.parse(p.createdAt || '');
    const r = Post.safeParse({
      id: p.id, handle: p.handle, url: 'https://x.com/' + p.handle + '/status/' + p.id, text: cleanText(p.text, 4000),
      createdAt: Number.isNaN(d) ? null : new Date(d).toISOString(), lang: typeof p.lang === 'string' && /^[a-z]{2,3}$/.test(p.lang) ? p.lang : null,
      links: (Array.isArray(p.links) ? p.links : []).map(safeHttpsUrl).filter(Boolean).slice(0, 20),
      quotedPostId: p.quotedPostId || null, quotedHandle: null,
      replyToHandle: typeof p.replyToHandle === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(p.replyToHandle) ? p.replyToHandle : null,
      capturedFrom: 'x_graphql'
    });
    return r.success ? r.data : null;
  }

  /** Everything this tab has observed about one account, as a schema-validated observation. */
  function buildObservation(handle: string, anchor: Element | null) {
    const h = handle.toLowerCase();
    const byId = new Map<string, any>();
    for (const p of seenPosts.get(h) || []) { const g = graphqlPost(p); if (g) byId.set(g.id, g); }
    for (const p of postsOnPage(document, handle)) {
      const prev = byId.get(p.id);
      byId.set(p.id, prev ? { ...p, createdAt: p.createdAt || prev.createdAt, lang: p.lang || prev.lang, links: p.links.length ? p.links : prev.links } : p);
    }
    const article = anchor ? anchor.closest('article[data-testid="tweet"]') : null;
    const focus = article ? extractPost(article, location.origin) : null;
    if (focus && !byId.has(focus.id)) byId.set(focus.id, focus);
    const loc = stated.get(h);
    const obs = {
      handle, observedAt: new Date().toISOString(), pageUrl: location.href.split('#')[0].slice(0, 2048), adapterVersion: ADAPTER_VERSION,
      about: aboutObservation(mem.get(h)),
      profileLocation: loc ? { text: loc, observedAt: new Date(statedAt.get(h) || Date.now()).toISOString() } : null,
      posts: [...byId.values()].slice(-100), focusPostId: focus ? focus.id : null
    };
    return AccountObservation.parse(obs);
  }

  function investigate(handle: string, anchor: Element | null) {
    if (!ext || !ext.runtime) return;
    if (!fresh(mem.get(handle.toLowerCase()))) {
      intentLookup(handle.toLowerCase()).then(() => investigate(handle, anchor), () => investigate2(handle, anchor));
      return;
    }
    investigate2(handle, anchor);
  }
  function investigate2(handle: string, anchor: Element | null) {
    if (!ext || !ext.runtime) return;
    let observation;
    try { observation = buildObservation(handle, anchor); }
    catch (e: any) { L.showToast(document, anchor, 'Chud Finder: could not read this page (' + (e && e.message || e) + ')'); return; }
    // Sent straight from the click handler so the background keeps the user gesture for sidePanel.open().
    ext.runtime.sendMessage({ type: 'investigate', observation }).then((r: any) => {
      if (r && r.ok === false) L.showToast(document, anchor, 'Chud Finder: ' + (r.error || 'investigation failed'));
    }, () => {});
  }

  function activate(el: HTMLElement, ctx: { handle: string; info: AboutInfo | null | undefined; statedLocation: string; prompt: string; url: string }) {
    const h = ctx.handle.toLowerCase();
    if (!fresh(mem.get(h))) {
      // Opening the popover is intent: look up now and refresh the popover when the answer arrives.
      const block = el.closest('[data-cf-handle]');
      intentLookup(h).then(() => {
        const open = document.querySelector('.cf-pop[aria-label="Chud Finder: @' + ctx.handle + '"]');
        const nb = block && block.querySelector('[data-cf-badge]') as HTMLElement | null;
        if (open && nb) activate(nb, { ...ctx, info: mem.get(h) });
      }, () => {});
      ctx = { ...ctx, info: { pending: true } };
    }
    openPopover(document, el, {
      handle: ctx.handle, info: mem.get(h) || ctx.info || null, statedLocation: stated.get(h) || ctx.statedLocation || '',
      evaluation: L.evaluate(mem.get(h) || ctx.info, settings, stated.get(h) || ''), askGrok: settings.askGrok !== false,
      topic: topicFor(el.closest(CF_SEL.article), ctx.handle, mem.get(h) || ctx.info),
      onInvestigate: () => { closePopover(document); investigate(ctx.handle, el); },
      onAskGrok: () => { closePopover(document); L.askGrok(document, el, ctx.prompt, ctx.url); }
    });
  }

  // ---- SPA routing -----------------------------------------------------------
  let lastHref = location.href;
  function checkRoute() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    closePopover(document);
    const r = parseRoute(location.href);
    if (ext && ext.runtime) ext.runtime.sendMessage({ type: 'route', route: r }).catch(() => {});
  }
  window.addEventListener('popstate', checkRoute);

  // Side panel "Refresh": the background asks this tab for a fresh observation.
  if (ext && ext.runtime && ext.runtime.onMessage) {
    ext.runtime.onMessage.addListener((msg: any, sender: any, sendResponse: (r: any) => void) => {
      if (!msg || msg.type !== 'observe' || (sender && sender.id !== ext.runtime.id)) return false;
      const h = typeof msg.handle === 'string' ? msg.handle : '';
      if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) { sendResponse({ ok: false, error: 'bad handle' }); return false; }
      const ready = mem.has(h.toLowerCase()) ? Promise.resolve() : lookup(h.toLowerCase(), true).then(() => {}, () => {});
      ready.then(() => {
        try { sendResponse({ ok: true, observation: buildObservation(h, null) }); }
        catch (e: any) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
      });
      return true;
    });
  }

  let scheduled = false;
  const mo = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; checkRoute(); scan(document); });
  });

  // ---- settings & lifecycle -------------------------------------------------
  async function init() {
    if (ext) {
      const got = await ext.storage.local.get(['settings', 'cf:queryId', PAUSE_KEY, PAUSE_REASON_KEY]);
      settings = Object.assign({}, L.DEFAULT_SETTINGS, got.settings || {}) as L.Settings;
      if (got['cf:queryId']) queryId = got['cf:queryId'];
      if (got[PAUSE_KEY]) pauseUntil = got[PAUSE_KEY];
      if (got[PAUSE_REASON_KEY] === 'daily') pauseReason = 'daily';
      ext.storage.onChanged.addListener((changes: any, area: string) => {
        if (area !== 'local') return;
        if (changes.settings) {
          const was = settings.enabled;
          settings = Object.assign({}, L.DEFAULT_SETTINGS, changes.settings.newValue || {}) as L.Settings;
          if (!settings.enabled) removeAll();
          else if (!was) { document.querySelectorAll('article[data-testid="tweet"]').forEach((a: any) => { a.__cfObserved = false; }); scan(document); pump(); }
          else rerenderAll();
        }
        if (changes[PAUSE_KEY]) pauseUntil = Math.max(pauseUntil, changes[PAUSE_KEY].newValue || 0);
        if (changes[PAUSE_REASON_KEY]) pauseReason = changes[PAUSE_REASON_KEY].newValue === 'daily' ? 'daily' : 'rate';
        if (changes['cf:cacheCleared']) { mem.clear(); }
      });
    }
    mo.observe(document.documentElement, { childList: true, subtree: true });
    scan(document);
  }

  init();
})();
