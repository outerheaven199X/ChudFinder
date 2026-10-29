/* Chud Finder - pure logic shared by the content script and the unit tests.
 * No network, no chrome.* APIs here.
 */
(function (root) {
  'use strict';

  const C = root.CFCountries || (typeof require === 'function' ? require('./countries.js') : null);

  const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
  // Paths under x.com that look like handles but aren't users.
  const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'search', 'settings',
    'compose', 'login', 'logout', 'signup', 'tos', 'privacy', 'jobs', 'premium', 'communities', 'lists']);

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    showName: true,            // show country name next to the flag
    highlightCountries: [],    // user-chosen ISO2 codes, empty by default
    vpnWarnings: true,         // warn when X says location may not be accurate (VPN/proxy)
    mismatchWarnings: true,    // warn when stated location / app-store region differs from "based in"
    topicMode: false,          // outline accounts outside the home country
    homeCountry: 'US',
    askGrok: true              // clicking a badge opens Grok with a prefilled prompt
  });

  function cleanHandle(h) {
    if (!h) return null;
    h = String(h).trim().replace(/^@/, '');
    if (!HANDLE_RE.test(h) || RESERVED.has(h.toLowerCase())) return null;
    return h;
  }

  /** Get the author handle from a [data-testid="User-Name"] block. */
  function handleFromUserName(block) {
    if (!block) return null;
    // 1) Profile link: <a href="/handle">
    for (const a of block.querySelectorAll('a[href]')) {
      const m = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(a.getAttribute('href') || '');
      if (m && cleanHandle(m[1])) return m[1];
    }
    // 2) Quoted tweets have no links, only the "@handle" text.
    for (const s of block.querySelectorAll('span')) {
      if (s.children.length) continue;
      const t = (s.textContent || '').trim();
      if (t.startsWith('@')) {
        const h = cleanHandle(t);
        if (h) return h;
      }
    }
    return null;
  }

  /**
   * Find every author block in a tweet article (main author + quoted tweet author).
   * Returns [{block, handle}].
   */
  function extractAuthors(article) {
    const out = [];
    if (!article || !article.querySelectorAll) return out;
    for (const block of article.querySelectorAll('[data-testid="User-Name"]')) {
      const handle = handleFromUserName(block);
      if (handle) out.push({ block, handle });
    }
    return out;
  }

  /** Classify X's about_profile.source, e.g. "Japan App Store", "Russian Federation Android App", "Web". */
  function classifySource(source) {
    const raw = typeof source === 'string' && source.trim() ? source.trim() : null;
    if (!raw) return { platform: null, country: null, raw: null };
    let m = /^(.*?)\s*app\s+store$/i.exec(raw);
    if (m) return { platform: 'iOS', country: m[1].trim() || null, raw };
    m = /^(.*?)\s*android\s+app$/i.exec(raw);
    if (m) return { platform: 'Android', country: m[1].trim() || null, raw };
    if (/^web$/i.test(raw)) return { platform: 'Web', country: null, raw };
    return { platform: null, country: null, raw };
  }

  /**
   * Parse an AboutAccountQuery response. Returns a compact record suitable for caching:
   * { basedIn, accurate, source, notFound }
   */
  function parseAbout(json, requested) {
    const user = json && json.data && json.data.user_result_by_screen_name &&
      json.data.user_result_by_screen_name.result;
    if (!user || user.__typename === 'UserUnavailable') return { basedIn: null, accurate: null, source: null, notFound: true };
    const sn = user.core && user.core.screen_name;
    if (requested && sn && sn.toLowerCase() !== String(requested).toLowerCase()) {
      throw new Error('Response for @' + sn + ' does not match @' + requested);
    }
    const p = user.about_profile || {};
    return {
      basedIn: p.account_based_in || null,
      // X shows a "may be connecting via VPN/proxy / location not accurate" note when this is false.
      accurate: p.location_accurate === false ? false : (p.location_accurate === true ? true : null),
      source: p.source || null,
      notFound: false
    };
  }

  /** Best-effort: which country does a free-text profile location point at? Returns ISO2 or null. */
  function countryFromStatedLocation(text) {
    if (!text || !C) return null;
    const t = C.norm(text);
    if (!t) return null;
    const direct = C.findCountry(t);
    if (direct) return direct.code;
    // Split on commas / separators and test each piece, last piece first ("Lagos, Nigeria").
    const parts = t.split(/[,|/·•\-–—]+/).map(s => s.trim()).filter(Boolean).reverse();
    for (const part of parts) {
      const c = C.findCountry(part);
      if (c) return c.code;
      for (const [name, abbr] of C.US_STATES) {
        if (part === name.toLowerCase()) return 'US';
        if (parts.length > 1 && part === abbr.toLowerCase()) return 'US';
      }
    }
    return null;
  }

  /** Decide how to present a lookup result. */
  function evaluate(info, settings, statedLocation) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const res = { known: false, code: null, name: null, isRegion: false, flag: '?', warnings: [],
      highlight: false, outside: false, source: null };
    if (!info || !info.basedIn) return res;

    res.known = true;
    res.name = info.basedIn;
    const c = C && C.findCountry(info.basedIn);
    if (c) { res.code = c.code; res.name = c.name; res.flag = C.flagEmoji(c.code); }
    else { res.isRegion = true; res.flag = '\u{1F310}'; }

    const src = classifySource(info.source);
    res.source = src;

    if (s.vpnWarnings && info.accurate === false) {
      res.warnings.push('X notes this account\u2019s location may not be accurate (possible VPN or proxy).');
    }
    if (s.mismatchWarnings) {
      if (src.country && res.code) {
        const sc = C.findCountry(src.country);
        if (sc && sc.code !== res.code) res.warnings.push('Connected via ' + src.raw + ', but based in ' + res.name + '.');
      }
      const stated = countryFromStatedLocation(statedLocation);
      if (stated && res.code && stated !== res.code) {
        res.warnings.push('Profile says \u201c' + statedLocation + '\u201d, but X says based in ' + res.name + '.');
      }
    }
    if (res.code && Array.isArray(s.highlightCountries) && s.highlightCountries.includes(res.code)) res.highlight = true;
    if (s.topicMode && s.homeCountry && res.code !== s.homeCountry) res.outside = true;
    return res;
  }

  const GROK_BASE = 'https://grok.com/';

  /** Neutral Grok prompt built only from data the extension has. Unknown parts are omitted. */
  function buildGrokPrompt(handle, info, statedLocation) {
    const h = cleanHandle(handle) || String(handle || '').replace(/^@/, '');
    const parts = ['Tell me about the X account @' + h + '.'];
    const basedIn = info && info.basedIn ? String(info.basedIn) : null;
    const src = info && info.source ? String(info.source).trim() : null;
    let about = null;
    if (basedIn && src) about = 'it\u2019s based in ' + basedIn + ' and connects via ' + (/^web$/i.test(src) ? 'the web' : 'the ' + src);
    else if (basedIn) about = 'it\u2019s based in ' + basedIn;
    else if (src) about = 'it connects via ' + (/^web$/i.test(src) ? 'the web' : 'the ' + src);
    let line = about ? 'X\u2019s About this account says ' + about : '';
    if (info && info.accurate === false) {
      line += (line ? '; ' : '') + 'X notes the location may not be accurate (possible VPN/proxy)';
    }
    if (line) parts.push(line.charAt(0).toUpperCase() + line.slice(1) + '.');
    if (statedLocation && String(statedLocation).trim()) {
      parts.push('Its self-reported profile location is \u201c' + String(statedLocation).trim() + '\u201d.');
    }
    parts.push('Based on its public posts and replies, what country or region does it most likely operate from? ' +
      'Give your confidence and the clues, keep it at country level, and remember location alone doesn\u2019t say whether its posts are accurate.');
    return parts.join(' ');
  }

  function grokUrl(prompt) { return GROK_BASE + '?q=' + encodeURIComponent(prompt); }

  function copyText(doc, text) {
    const win = doc.defaultView || {};
    const fallback = () => {
      try {
        const ta = doc.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        (doc.body || doc.documentElement).appendChild(ta);
        ta.select();
        const ok = doc.execCommand && doc.execCommand('copy');
        ta.remove();
        return !!ok;
      } catch (_) { return false; }
    };
    try {
      const nav = win.navigator;
      if (nav && nav.clipboard && nav.clipboard.writeText) {
        return nav.clipboard.writeText(text).then(() => true, () => fallback());
      }
    } catch (_) { /* fall through */ }
    return Promise.resolve(fallback());
  }

  function showToast(doc, anchor, msg) {
    try {
      const old = doc.querySelector('.cf-toast'); if (old) old.remove();
      const t = doc.createElement('div');
      t.className = 'cf-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
      const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      if (r) { t.style.top = Math.max(4, r.bottom + 6) + 'px'; t.style.left = Math.max(4, r.left) + 'px'; }
      (doc.body || doc.documentElement).appendChild(t);
      const win = doc.defaultView;
      (win && win.setTimeout ? win.setTimeout.bind(win) : setTimeout)(() => t.remove(), 2200);
      return t;
    } catch (_) { return null; }
  }

  /** Click / Enter / Space on a badge: copy prompt, toast, open Grok. Never lets X navigate. */
  function attachAskGrok(doc, el, handle, info, statedLocation) {
    const prompt = buildGrokPrompt(handle, info, statedLocation);
    const url = grokUrl(prompt);
    el.classList.add('cf-ask');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('data-cf-grok-url', url);
    const go = e => {
      e.preventDefault(); e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      copyText(doc, prompt);
      showToast(doc, el, 'Prompt copied, opening Grok');
      const win = doc.defaultView;
      if (win && win.open) win.open(url, '_blank', 'noopener');
    };
    const swallow = e => { e.preventDefault(); e.stopPropagation(); };
    el.addEventListener('click', go);
    // X's link reacts on mousedown/auxclick too in some builds; keep those from navigating.
    el.addEventListener('auxclick', swallow);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') go(e); });
    return { prompt, url };
  }

  /** Build (or update) the badge element. */
  function renderBadge(doc, info, settings, statedLocation, handle) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const ev = evaluate(info, s, statedLocation);
    const el = doc.createElement('span');
    el.className = 'cf-badge';
    el.setAttribute('data-cf-badge', '');
    if (handle) el.setAttribute('data-cf-for', handle.toLowerCase());

    const flag = doc.createElement('span');
    flag.className = 'cf-flag';
    flag.textContent = ev.flag;
    el.appendChild(flag);

    if (!ev.known) {
      el.classList.add('cf-unknown');
      el.title = info && info.pending ? 'Chud Finder: looking up\u2026'
        : info && info.error ? 'Chud Finder: lookup failed (' + info.error + ')'
        : 'Chud Finder: X does not show an \u201cAccount based in\u201d country for this account.';
      if (info && info.pending) el.classList.add('cf-pending');
      else if (s.askGrok && handle) {
        attachAskGrok(doc, el, handle, info, statedLocation);
        el.title += '\nClick to ask Grok about @' + handle + '.';
      }
      return el;
    }

    if (s.showName) {
      const name = doc.createElement('span');
      name.className = 'cf-name';
      name.textContent = ev.name;
      el.appendChild(name);
    }
    if (ev.warnings.length) {
      el.classList.add('cf-warn');
      const w = doc.createElement('span');
      w.className = 'cf-warn-icon';
      w.textContent = '\u26A0';
      el.appendChild(w);
    }
    if (ev.highlight) el.classList.add('cf-highlight');
    if (ev.outside) el.classList.add('cf-outside');

    const lines = ['Account based in: ' + ev.name + (ev.isRegion ? ' (region)' : '')];
    if (ev.source && ev.source.raw) lines.push('Connected via: ' + ev.source.raw);
    if (statedLocation) lines.push('Profile location (self-reported): ' + statedLocation);
    for (const w of ev.warnings) lines.push('\u26A0 ' + w);
    lines.push('Source: X \u201cAbout this account\u201d. A location is context, not proof a post is true or false.');
    if (s.askGrok && handle) {
      attachAskGrok(doc, el, handle, info, statedLocation);
      lines.push('Click to ask Grok about @' + handle + ' (prompt is also copied).');
    }
    el.title = lines.join('\n');
    return el;
  }

  const api = { DEFAULT_SETTINGS, cleanHandle, handleFromUserName, extractAuthors, classifySource,
    parseAbout, countryFromStatedLocation, evaluate, renderBadge,
    buildGrokPrompt, grokUrl, copyText, attachAskGrok, GROK_BASE };
  root.CFLib = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
