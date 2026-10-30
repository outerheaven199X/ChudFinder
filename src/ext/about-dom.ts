import { AboutObservation } from '../shared/schemas.ts';
import { cleanHandle, parseRoute } from './xdom.ts';
import { cleanText } from '../shared/sanitize.ts';

/** Only rendered X About fields. Never infer a country from a bio, language or store region. */
export function readAbout(doc: Document, href: string, now = new Date().toISOString()) {
  const u = new URL(href), route = parseRoute(href);
  if (!['x.com','twitter.com'].includes(u.hostname) || !route.handle || !/\/about\/?$/.test(u.pathname)) return null;
  const rows = [...doc.querySelectorAll('[data-testid="pivot"], [role="tab"]')];
  const field = (label: string) => {
    const row = rows.find(e => [...e.querySelectorAll('span')].some(s => s.textContent?.trim() === label));
    if (!row) return undefined;
    const leaves = [...row.querySelectorAll('span')].filter(e => !e.querySelector('span')).map(e => e.textContent?.trim() || '');
    const at = leaves.indexOf(label);
    return cleanText(leaves.slice(at + 1).join(' '),80) || null;
  };
  const basedIn = field('Account based in'), source = field('Connected via');
  if (basedIn === undefined && source === undefined) return null;
  const warning = locationWarning(doc);
  return AboutObservation.parse({
    basedIn: basedIn && !/^(unknown|not available|unavailable)$/i.test(basedIn) ? basedIn : null,
    source: source || null, accurate: warning ? false : null, notFound: !basedIn && !source,
    sourceUrl: `https://x.com/${route.handle}/about`, observedAt: now,
    provenance: 'page_observed', ...(warning ? {displayText:warning} : {}),
  });
}
export function locationWarning(doc: Document) {
  const text = doc.body?.textContent || '';
  const match = /Country or region may not be accurate[\s\S]{0,900}/i.exec(text);
  return match ? cleanText(match[0].split(/\bOK\b/)[0],600) : null;
}
export function aboutFailure(doc: Document) {
  const text = doc.querySelector('main')?.textContent || doc.body?.textContent || '';
  if (/verify you are human|unusual activity|temporarily limited|rate limit/i.test(text)) return 'X paused access. Open X and resolve its prompt; automatic lookups have paused.';
  if (/this account doesn.t exist|account suspended|account is unavailable/i.test(text)) return 'X says this account is unavailable.';
  if (/sign in to X|log in to X/i.test(text) && !doc.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')) return 'Sign in to X in this browser, then retry.';
  return null;
}
export function workerToken(href: string) {
  const u = new URL(href), h = parseRoute(href).handle;
  return h && cleanHandle(h) && /\/about\/?$/.test(u.pathname) ? new URLSearchParams(u.hash.slice(1)).get('cf-country-read') : null;
}
