/* Chud Finder - runs in the page's MAIN world at document_start.
 * Read-only observer of X's own GraphQL traffic. It:
 *   - captures the web client's bearer token (authorization header) and the
 *     AboutAccountQuery query id if the page itself uses it, so lookups keep
 *     working when X rotates them;
 *   - reads the self-reported profile "location" of users that appear in
 *     timeline responses (used only for the mismatch hint).
 *   - collects recent posts (id, text, time, language tag, links) of users in those responses,
 *     used only as on-page evidence when you click Investigate.
 * It never sends anything anywhere; it only posts messages to the content script.
 */
(function () {
  'use strict';
  type Any = any;
  const TAG = '__chudFinder';
  const GQL = '/i/api/graphql/';
  let sentAuth: string | null = null;
  const seenQueryIds = new Set<string>();

  function post(type: string, payload: unknown) {
    try { window.postMessage({ [TAG]: true, type, payload }, location.origin); } catch (_) { /* ignore */ }
  }

  function noteRequest(url: string, getHeader: (n: string) => string | null | undefined) {
    try {
      if (!url || url.indexOf(GQL) === -1) return;
      const m = /\/i\/api\/graphql\/([A-Za-z0-9_-]+)\/AboutAccountQuery/.exec(url);
      if (m && !seenQueryIds.has(m[1])) { seenQueryIds.add(m[1]); post('queryId', m[1]); }
      const auth = getHeader('authorization');
      if (auth && /^Bearer /.test(auth) && auth !== sentAuth) { sentAuth = auth; post('auth', auth); }
    } catch (_) { /* ignore */ }
  }

  // Collect {screen_name -> location} from any user objects in a GraphQL payload.
  function harvest(json: Any) {
    const out: Record<string, string> = {};
    const posts: Any[] = [];
    let budget = 20000; // bound the walk on huge payloads
    (function walk(o: Any, depth: number) {
      if (!o || typeof o !== 'object' || depth > 40 || budget-- <= 0) return;
      if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return; }
      if (o.__typename === 'User') {
        const sn = (o.core && o.core.screen_name) || (o.legacy && o.legacy.screen_name);
        const loc = (o.location && typeof o.location === 'object' ? o.location.location : null) ||
          (o.legacy && o.legacy.location) || '';
        if (sn && typeof loc === 'string') out[sn.toLowerCase()] = loc.trim();
      }
      if ((o.__typename === 'Tweet' || (o.rest_id && o.legacy && typeof o.legacy.full_text === 'string')) && posts.length < 200) {
        const p = tweetRecord(o);
        if (p) posts.push(p);
      }
      for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) walk(o[k], depth + 1);
    })(json, 0);
    const n = Object.keys(out).length;
    if (n) post('locations', out);
    if (posts.length) post('posts', posts);
  }

  function tweetRecord(o: Any) {
    try {
      const u = o.core && o.core.user_results && o.core.user_results.result;
      const sn = u && ((u.core && u.core.screen_name) || (u.legacy && u.legacy.screen_name));
      const L = o.legacy || {};
      if (!sn || !/^\d{1,25}$/.test(String(o.rest_id || ''))) return null;
      const note = o.note_tweet && o.note_tweet.note_tweet_results && o.note_tweet.note_tweet_results.result;
      const urls = ((L.entities && L.entities.urls) || []).map((x: Any) => x && x.expanded_url).filter((x: Any) => typeof x === 'string').slice(0, 20);
      const q = o.quoted_status_result && o.quoted_status_result.result;
      return {
        id: String(o.rest_id), handle: String(sn), text: String((note && note.text) || L.full_text || '').slice(0, 4000),
        createdAt: typeof L.created_at === 'string' ? L.created_at : null, lang: typeof L.lang === 'string' ? L.lang : null,
        links: urls, quotedPostId: q && q.rest_id ? String(q.rest_id) : null,
        replyToHandle: typeof L.in_reply_to_screen_name === 'string' ? L.in_reply_to_screen_name : null
      };
    } catch (_) { return null; }
  }

  // --- fetch ---
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (this: Any, input: Any, init?: Any) {
      let url = '';
      try {
        url = typeof input === 'string' ? input : (input && input.url) || String(input);
        const h = new Headers((init && init.headers) || (input && input.headers) || undefined);
        noteRequest(url, (n: string) => h.get(n));
      } catch (_) { /* ignore */ }
      const p = origFetch.apply(this, arguments as Any);
      if (url.indexOf(GQL) !== -1 && url.indexOf('AboutAccountQuery') === -1) {
        p.then((r: Any) => {
          try {
            if ((r.headers.get('content-type') || '').indexOf('json') !== -1) r.clone().json().then(harvest, () => {});
          } catch (_) { /* ignore */ }
        }, () => {});
      }
      return p;
    };
  }

  // --- XHR ---
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.setRequestHeader;
  const XSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: Any, method: string, url: string) {
    this.__cfUrl = String(url || ''); this.__cfHeaders = {};
    return (XO as Any).apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (this: Any, k: string, v: string) {
    try { if (this.__cfHeaders) this.__cfHeaders[String(k).toLowerCase()] = v; } catch (_) { /* ignore */ }
    return (XS as Any).apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (this: Any) {
    const url = this.__cfUrl || '';
    if (url.indexOf(GQL) !== -1) {
      const hs: Any = this.__cfHeaders || {};
      noteRequest(url, (n: string) => hs[n]);
      if (url.indexOf('AboutAccountQuery') === -1) {
        this.addEventListener('load', () => {
          try {
            if (this.responseType === 'json' && this.response) harvest(this.response);
            else if (!this.responseType || this.responseType === 'text') harvest(JSON.parse(this.responseText));
          } catch (_) { /* ignore */ }
        });
      }
    }
    return (XSend as Any).apply(this, arguments);
  };
})();
