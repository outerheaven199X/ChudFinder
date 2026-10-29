/* Chud Finder - runs in the page's MAIN world at document_start.
 * Read-only observer of X's own GraphQL traffic. It:
 *   - captures the web client's bearer token (authorization header) and the
 *     AboutAccountQuery query id if the page itself uses it, so lookups keep
 *     working when X rotates them;
 *   - reads the self-reported profile "location" of users that appear in
 *     timeline responses (used only for the mismatch hint).
 * It never sends anything anywhere; it only posts messages to the content script.
 */
(function () {
  'use strict';
  const TAG = '__chudFinder';
  const GQL = '/i/api/graphql/';
  let sentAuth = null;
  const seenQueryIds = new Set();

  function post(type, payload) {
    try { window.postMessage({ [TAG]: true, type, payload }, location.origin); } catch (_) { /* ignore */ }
  }

  function noteRequest(url, getHeader) {
    try {
      if (!url || url.indexOf(GQL) === -1) return;
      const m = /\/i\/api\/graphql\/([A-Za-z0-9_-]+)\/AboutAccountQuery/.exec(url);
      if (m && !seenQueryIds.has(m[1])) { seenQueryIds.add(m[1]); post('queryId', m[1]); }
      const auth = getHeader('authorization');
      if (auth && /^Bearer /.test(auth) && auth !== sentAuth) { sentAuth = auth; post('auth', auth); }
    } catch (_) { /* ignore */ }
  }

  // Collect {screen_name -> location} from any user objects in a GraphQL payload.
  function harvest(json) {
    const out = {};
    let budget = 20000; // bound the walk on huge payloads
    (function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 40 || budget-- <= 0) return;
      if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return; }
      if (o.__typename === 'User') {
        const sn = (o.core && o.core.screen_name) || (o.legacy && o.legacy.screen_name);
        const loc = (o.location && typeof o.location === 'object' ? o.location.location : null) ||
          (o.legacy && o.legacy.location) || '';
        if (sn && typeof loc === 'string') out[sn.toLowerCase()] = loc.trim();
      }
      for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) walk(o[k], depth + 1);
    })(json, 0);
    const n = Object.keys(out).length;
    if (n) post('locations', out);
  }

  // --- fetch ---
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      let url = '';
      try {
        url = typeof input === 'string' ? input : (input && input.url) || String(input);
        const h = new Headers((init && init.headers) || (input && input.headers) || undefined);
        noteRequest(url, n => h.get(n));
      } catch (_) { /* ignore */ }
      const p = origFetch.apply(this, arguments);
      if (url.indexOf(GQL) !== -1 && url.indexOf('AboutAccountQuery') === -1) {
        p.then(r => {
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
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__cfUrl = String(url || ''); this.__cfHeaders = {};
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (this.__cfHeaders) this.__cfHeaders[String(k).toLowerCase()] = v; } catch (_) { /* ignore */ }
    return XS.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const url = this.__cfUrl || '';
    if (url.indexOf(GQL) !== -1) {
      const hs = this.__cfHeaders || {};
      noteRequest(url, n => hs[n]);
      if (url.indexOf('AboutAccountQuery') === -1) {
        this.addEventListener('load', () => {
          try {
            if (this.responseType === 'json' && this.response) harvest(this.response);
            else if (!this.responseType || this.responseType === 'text') harvest(JSON.parse(this.responseText));
          } catch (_) { /* ignore */ }
        });
      }
    }
    return XSend.apply(this, arguments);
  };
})();
