/* Chud Finder - pure logic shared by the content script and the unit tests.
 * No network, no chrome.* APIs here.
 */
import * as C from '../shared/countries.ts';
import { classifySource, countryFromStatedLocation } from '../shared/geo.ts';
import { GROK_BASE, grokUrl } from '../shared/prompts.ts';
import { cleanText } from '../shared/sanitize.ts';
import type { TopicSignal } from '../shared/topics.ts';
import { extractAuthors, handleFromUserName, cleanHandle } from './xdom.ts';

export interface AboutInfo { basedIn?: string | null; accurate?: boolean | null; source?: string | null; notFound?: boolean; pending?: boolean; idle?: boolean; error?: string; t?: number }

  export interface Settings {
    enabled: boolean; showName: boolean; highlightCountries: string[]; vpnWarnings: boolean; mismatchWarnings: boolean;
    topicMode: boolean; homeCountry: string; askGrok: boolean; lookupMode: 'careful' | 'auto'; dailyCap: number; popover: boolean; grokBotTemplateUrl: string; [k: string]: any;
  }
  const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
    enabled: true,
    showName: true,            // show country name next to the flag
    highlightCountries: [],    // user-chosen ISO2 codes, empty by default
    vpnWarnings: true,         // warn when X says location may not be accurate (VPN/proxy)
    mismatchWarnings: true,    // warn when stated location / app-store region differs from "based in"
    topicMode: false,          // outline accounts outside the home country
    homeCountry: 'US',
    askGrok: true,             // Ask Grok action (badge click when popover is off, button in the popover)
    popover: true,             // clicking a badge opens the provenance popover (Investigate / Ask Grok)
    lookupMode: 'careful',     // passive capture; background About visits require an explicit Auto selection
    dailyCap: 300,             // lookups per local day across all tabs (50-1000)
    grokBotTemplateUrl: ''     // optional link to the Chud Finder Grok Bot template; empty = hidden
  });

  /**
   * Parse an legacy display payload response. Returns a compact record suitable for caching:
   * { basedIn, accurate, source, notFound }
   */
  function parseAbout(json: any, requested?: string): AboutInfo {
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

  /** Decide how to present a lookup result. */
  function evaluate(info: AboutInfo | null | undefined, settings?: Partial<Settings> | null, statedLocation?: string) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const res: any = { known: false, code: null, name: null, isRegion: false, flag: '?', warnings: [],
      highlight: false, outside: false, source: null };
    if (!info || !info.basedIn) return res;

    res.known = true;
    res.name = info.basedIn;
    const c = C.findCountry(info.basedIn);
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

  /** Neutral Grok prompt built only from data the extension has. Unknown parts are omitted. */
  function buildGrokPrompt(handle: string, info: AboutInfo | null | undefined, statedLocation?: string): string {
    const h = cleanHandle(handle) || String(handle || '').replace(/^@/, '');
    const parts = ['Tell me about the X account @' + h + '.'];
    const basedIn = info && info.basedIn ? String(info.basedIn) : null;
    const src = info && info.source ? String(info.source).trim() : null;
    let about: string | null = null;
    if (basedIn && src) about = 'it\u2019s based in ' + basedIn + ' and connects via ' + (/^web$/i.test(src) ? 'the web' : 'the ' + src);
    else if (basedIn) about = 'it\u2019s based in ' + basedIn;
    else if (src) about = 'it connects via ' + (/^web$/i.test(src) ? 'the web' : 'the ' + src);
    let line = about ? 'User-captured X display says ' + about : '';
    if (info && info.accurate === false) {
      line += (line ? '; ' : '') + 'X notes the location may not be accurate (possible VPN/proxy)';
    }
    if (line) parts.push(line.charAt(0).toUpperCase() + line.slice(1) + '.');
    if (statedLocation && String(statedLocation).trim()) {
      parts.push('Its self-reported profile location is \u201c' + String(statedLocation).trim() + '\u201d.');
    }
    parts.push('Explain these user-supplied observations and unanswered questions. Do not infer physical location or treat a country as evidence of truth. Additional source suggestions remain unverified.');
    return parts.join(' ');
  }


  function copyText(doc: Document, text: string): Promise<boolean> {
    const win: any = doc.defaultView || {};
    const fallback = () => {
      try {
        const ta = doc.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        (doc.body || doc.documentElement).appendChild(ta);
        ta.select();
        const ok = (doc as any).execCommand && (doc as any).execCommand('copy');
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

  function showToast(doc: Document, anchor: Element | null, msg: string): HTMLElement | null {
    try {
      const old = doc.querySelector('.cf-toast'); if (old) old.remove();
      const t = doc.createElement('div');
      t.className = 'cf-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
      const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      if (r) { t.style.top = Math.max(4, r.bottom + 6) + 'px'; t.style.left = Math.max(4, r.left) + 'px'; }
      (doc.body || doc.documentElement).appendChild(t);
      const win: any = doc.defaultView;
      (win && win.setTimeout ? win.setTimeout.bind(win) : setTimeout)(() => t.remove(), 2200);
      return t;
    } catch (_) { return null; }
  }

  /** Click / Enter / Space on a badge: copy prompt, toast, open Grok. Never lets X navigate. */
  function attachAskGrok(doc: Document, el: HTMLElement, handle: string, info: AboutInfo | null | undefined, statedLocation?: string, onActivate?: ActivateFn) {
    const prompt = buildGrokPrompt(handle, info, statedLocation);
    const url = grokUrl(prompt);
    el.classList.add('cf-ask');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('data-cf-grok-url', url);
    const go = (e: Event) => {
      e.preventDefault(); e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (onActivate) { onActivate(el, { handle, info, statedLocation: statedLocation || '', prompt, url }); return; }
      askGrok(doc, el, prompt, url);
    };
    const swallow = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    el.addEventListener('click', go);
    // X's link reacts on mousedown/auxclick too in some builds; keep those from navigating.
    el.addEventListener('auxclick', swallow);
    el.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') go(e); });
    return { prompt, url };
  }

  /** Copy the prompt, toast, open Grok in a new tab. */
  function askGrok(doc: Document, anchor: Element | null, prompt: string, url: string) {
      copyText(doc, prompt);
      showToast(doc, anchor, 'Prompt copied, opening Grok');
      const win: any = doc.defaultView;
      if (win && win.open) win.open(url, '_blank', 'noopener');
  }

  /** Build (or update) the badge element. */
  function renderBadge(doc: Document, info: AboutInfo | null | undefined, settings?: Partial<Settings> | null, statedLocation?: string, handle?: string, onActivate?: ActivateFn): HTMLElement {
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
      if (info && info.idle) el.classList.add('cf-idle');
      el.title = info && info.pending ? 'Chud Finder: looking up\u2026'
        : info && info.idle ? 'Chud Finder (careful mode): not checked yet. Hover for a moment or click to check where X says this account is based.'
        : info && info.error ? 'Chud Finder: lookup failed (' + info.error + ')'
        : 'Chud Finder: X does not show an \u201cAccount based in\u201d country for this account.';
      if (info && info.pending) el.classList.add('cf-pending');
      else if (handle && (onActivate || s.askGrok)) {
        attachAskGrok(doc, el, handle, info, statedLocation, onActivate);
        el.title += onActivate ? '\nClick for details and Investigate.' : '\nClick to ask Grok about @' + handle + '.';
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
    if (handle && (onActivate || s.askGrok)) {
      attachAskGrok(doc, el, handle, info, statedLocation, onActivate);
      lines.push(onActivate ? 'Click for details, Investigate and Ask Grok.' : 'Click to ask Grok about @' + handle + ' (prompt is also copied).');
    }
    el.title = lines.join('\n');
    return el;
  }

  /** Neutral, inferred topic/location note shown under a post in topic mode. textContent only. */
  function renderTopicNote(doc: Document, sig: TopicSignal): HTMLElement {
    const el = doc.createElement('div');
    el.className = 'cf-topic'; el.setAttribute('data-cf-topic', ''); el.setAttribute('role', 'note');
    const tag = doc.createElement('span'); tag.className = 'cf-topic-tag'; tag.textContent = '[INFERRED]';
    const t = doc.createElement('span'); t.className = 'cf-topic-text'; t.textContent = sig.text;
    el.append(tag, t);
    el.title = 'Chud Finder topic mode: keyword topic tags (' + sig.topics.join(', ') + ') compared with X\u2019s \u201cAbout this account\u201d. Not a judgement of the post or its author.';
    return el;
  }

export type ActivateFn = (el: HTMLElement, ctx: { handle: string; info: AboutInfo | null | undefined; statedLocation: string; prompt: string; url: string }) => void;
export const CFLib = { DEFAULT_SETTINGS, cleanHandle, handleFromUserName, extractAuthors, classifySource,
  parseAbout, countryFromStatedLocation, evaluate, renderBadge,
  buildGrokPrompt, grokUrl, copyText, attachAskGrok, askGrok, showToast, renderTopicNote, GROK_BASE };
export { renderTopicNote, DEFAULT_SETTINGS, cleanHandle, handleFromUserName, extractAuthors, classifySource, parseAbout, countryFromStatedLocation,
  evaluate, renderBadge, buildGrokPrompt, grokUrl, copyText, attachAskGrok, askGrok, showToast, GROK_BASE };
