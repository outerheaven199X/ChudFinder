/* Chud Finder - settings document validation (schemaVersion 1).
 * Used for the remote "Settings source URL", pasted settings codes, and exports.
 * Data only: the document is parsed with JSON.parse and every value is type-checked.
 * Nothing in it is ever evaluated or executed.
 */
(function (root) {
  'use strict';
  const C = root.CFCountries || (typeof require === 'function' ? require('./countries.js') : null);

  const SCHEMA_VERSION = 1;
  const MAX_BYTES = 64 * 1024;
  const MAX_COUNTRIES = 300;
  const BOOL_KEYS = ['enabled', 'topicMode', 'vpnWarnings', 'mismatchWarnings', 'showName', 'askGrok'];
  const KNOWN = new Set(['schemaVersion', 'homeCountry', 'highlightCountries', 'updatedAt', 'note'].concat(BOOL_KEYS));

  function resolveCountry(v) {
    if (typeof v !== 'string' || !v.trim() || v.length > 80) return null;
    const s = v.trim();
    if (/^[A-Za-z]{2}$/.test(s)) {
      const code = s.toUpperCase();
      return C.COUNTRIES.some(c => c.code === code) ? code : null;
    }
    const c = C.findCountry(s);
    return c ? c.code : null;
  }

  /**
   * Validate a parsed settings document.
   * Returns { ok, settings, errors, warnings }. On any error, ok=false and settings=null:
   * a partly-bad document is rejected whole, so a typo can't silently change behaviour.
   */
  function validate(doc) {
    const errors = [], warnings = [];
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      return { ok: false, settings: null, errors: ['Settings must be a JSON object.'], warnings };
    }
    if (doc.schemaVersion !== SCHEMA_VERSION) {
      errors.push('schemaVersion must be ' + SCHEMA_VERSION + ' (got ' + JSON.stringify(doc.schemaVersion) + ').');
    }
    const out = {};
    for (const k of BOOL_KEYS) {
      if (!(k in doc)) continue;
      if (typeof doc[k] !== 'boolean') errors.push(k + ' must be true or false.');
      else out[k] = doc[k];
    }
    if ('homeCountry' in doc) {
      const code = resolveCountry(doc.homeCountry);
      if (!code) errors.push('homeCountry ' + JSON.stringify(doc.homeCountry) + ' is not a known country.');
      else out.homeCountry = code;
    }
    if ('highlightCountries' in doc) {
      const list = doc.highlightCountries;
      if (!Array.isArray(list)) errors.push('highlightCountries must be an array.');
      else if (list.length > MAX_COUNTRIES) errors.push('highlightCountries has more than ' + MAX_COUNTRIES + ' entries.');
      else {
        const codes = [], bad = [];
        for (const v of list) {
          const code = resolveCountry(v);
          if (code) { if (!codes.includes(code)) codes.push(code); } else bad.push(v);
        }
        if (bad.length) errors.push('Unknown countries in highlightCountries: ' + bad.map(b => JSON.stringify(b)).join(', ') + '.');
        else out.highlightCountries = codes;
      }
    }
    for (const k of Object.keys(doc)) if (!KNOWN.has(k)) warnings.push('Ignored unknown key "' + k + '".');
    if (errors.length) return { ok: false, settings: null, errors, warnings };
    return { ok: true, settings: out, errors, warnings };
  }

  /** Parse a JSON string (size-limited) and validate it. */
  function parseAndValidate(text) {
    if (typeof text !== 'string') return { ok: false, settings: null, errors: ['No settings text.'], warnings: [] };
    if (text.length > MAX_BYTES) return { ok: false, settings: null, errors: ['Settings document is larger than 64 KB.'], warnings: [] };
    let doc;
    try { doc = JSON.parse(text); } catch (e) {
      return { ok: false, settings: null, errors: ['Not valid JSON: ' + e.message], warnings: [] };
    }
    return validate(doc);
  }

  /** Apply validated (partial) settings on top of current ones. Keys not in the document are kept. */
  function merge(current, incoming) {
    const out = Object.assign({}, current || {});
    for (const [k, v] of Object.entries(incoming || {})) {
      out[k] = Array.isArray(v) ? v.slice() : v;
    }
    return out;
  }

  // UTF-8 safe base64 (works in browsers, workers and Node).
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  /** Settings -> shareable code (base64 of the schema JSON). */
  function exportCode(settings) {
    const doc = { schemaVersion: SCHEMA_VERSION };
    for (const k of BOOL_KEYS) if (typeof settings[k] === 'boolean') doc[k] = settings[k];
    if (settings.homeCountry) doc.homeCountry = settings.homeCountry;
    doc.highlightCountries = Array.isArray(settings.highlightCountries) ? settings.highlightCountries.slice() : [];
    return b64encode(JSON.stringify(doc));
  }

  /** Code -> validation result. Also accepts raw JSON pasted directly. */
  function importCode(code) {
    const s = String(code || '').trim();
    if (s.startsWith('{')) return parseAndValidate(s);
    const clean = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return { ok: false, settings: null, errors: ['Not a valid settings code.'], warnings: [] };
    let text;
    try { text = b64decode(clean); } catch (_) {
      return { ok: false, settings: null, errors: ['Not a valid settings code.'], warnings: [] };
    }
    return parseAndValidate(text);
  }

  /** Only plain https URLs, no credentials embedded. Returns a URL object or null. */
  function checkSourceUrl(str) {
    let u;
    try { u = new URL(String(str || '').trim()); } catch (_) { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return null;
    return u;
  }

  const api = { SCHEMA_VERSION, MAX_BYTES, validate, parseAndValidate, merge, exportCode, importCode, checkSourceUrl, resolveCountry };
  root.CFSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
