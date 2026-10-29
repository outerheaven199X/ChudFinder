/* Chud Finder - versioned X DOM adapter. All knowledge of X's markup lives here, so when X changes
 * its DOM only this file (and ADAPTER_VERSION) changes. Reads only; never modifies X's own nodes
 * except for appending badges (done by the content script). */
import { cleanText, safeHttpsUrl } from '../shared/sanitize.ts';
import type { Post } from '../shared/schemas.ts';

export const ADAPTER_VERSION = 'x-dom@2026-10.1';

export const SEL = {
  article: 'article[data-testid="tweet"]',
  userName: '[data-testid="User-Name"]',
  tweetText: '[data-testid="tweetText"]',
  quoted: 'div[role="link"]',
  time: 'time[datetime]'
} as const;

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
// Paths under x.com that look like handles but aren't users.
const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'search', 'settings',
  'compose', 'login', 'logout', 'signup', 'tos', 'privacy', 'jobs', 'premium', 'communities', 'lists']);

export function cleanHandle(h: unknown): string | null {
  if (!h) return null;
  const s = String(h).trim().replace(/^@/, '');
  if (!HANDLE_RE.test(s) || RESERVED.has(s.toLowerCase())) return null;
  return s;
}

/** Get the author handle from a [data-testid="User-Name"] block. */
export function handleFromUserName(block: Element | null): string | null {
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

/** Find every author block in a tweet article (main author + quoted tweet author). */
export function extractAuthors(article: Element | null): { block: Element; handle: string }[] {
  const out: { block: Element; handle: string }[] = [];
  if (!article || !article.querySelectorAll) return out;
  for (const block of article.querySelectorAll(SEL.userName)) {
    const handle = handleFromUserName(block);
    if (handle) out.push({ block, handle });
  }
  return out;
}

function quotedBlock(article: Element): Element | null {
  for (const q of article.querySelectorAll(SEL.quoted)) if (q.querySelector(SEL.userName)) return q;
  return null;
}

const STATUS_RE = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})(?:[/?#]|$)/;

/** Extract the main post (not the quoted one) of an article. Returns null if it has no permalink. */
export function extractPost(article: Element, origin = 'https://x.com'): Post | null {
  const quoted = quotedBlock(article);
  const inQuoted = (el: Element) => !!(quoted && quoted.contains(el));
  let handle: string | null = null, id: string | null = null, createdAt: string | null = null;
  for (const t of article.querySelectorAll(SEL.time)) {
    if (inQuoted(t)) continue;
    const a = t.closest('a[href]');
    const m = a ? STATUS_RE.exec(a.getAttribute('href') || '') : null;
    if (m && cleanHandle(m[1])) {
      handle = m[1]; id = m[2];
      const d = Date.parse(t.getAttribute('datetime') || '');
      createdAt = Number.isNaN(d) ? null : new Date(d).toISOString();
      break;
    }
  }
  if (!handle || !id) return null;
  const textEl = [...article.querySelectorAll(SEL.tweetText)].find(el => !inQuoted(el)) || null;
  const text = textEl ? cleanText(textEl.textContent || '', 4000) : '';
  const lang = textEl ? (textEl.getAttribute('lang') || null) : null;
  const links: string[] = [];
  if (textEl) {
    for (const a of textEl.querySelectorAll('a[href]')) {
      const raw = a.getAttribute('href') || '';
      if (raw.startsWith('/')) continue;                     // hashtags, mentions
      const shown = (a.textContent || '').replace(/\u2026$/, '').trim();
      const u = safeHttpsUrl(/^https?:\/\//.test(shown) ? shown.replace(/^http:/, 'https:') : raw);
      if (u && !links.includes(u) && links.length < 20) links.push(u);
    }
  }
  let quotedHandle: string | null = null, quotedPostId: string | null = null;
  if (quoted) {
    quotedHandle = handleFromUserName(quoted.querySelector(SEL.userName));
    for (const a of quoted.querySelectorAll('a[href]')) {
      const m = STATUS_RE.exec(a.getAttribute('href') || '');
      if (m) { quotedPostId = m[2]; quotedHandle = quotedHandle || m[1]; break; }
    }
  }
  let replyToHandle: string | null = null;
  for (const el of article.querySelectorAll('div')) {
    if (inQuoted(el) || el.children.length > 4) continue;
    const t = (el.textContent || '').trim();
    if (t.length < 80 && /^Replying to\b/.test(t)) {
      const a = el.querySelector('a[href^="/"]');
      replyToHandle = a ? cleanHandle((a.getAttribute('href') || '').slice(1)) : cleanHandle((/@(\w{1,15})/.exec(t) || [])[1]);
      break;
    }
  }
  return {
    id, handle, url: origin.replace(/\/$/, '') + '/' + handle + '/status/' + id, text, createdAt,
    lang: lang && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang) ? lang : null,
    links, quotedPostId, quotedHandle, replyToHandle, capturedFrom: 'x_page_dom'
  };
}

/** All main posts currently in the page (optionally only by one handle). */
export function postsOnPage(doc: Document, handle?: string, limit = 50): Post[] {
  const out: Post[] = []; const seen = new Set<string>();
  for (const a of doc.querySelectorAll(SEL.article)) {
    const p = extractPost(a, doc.location ? doc.location.origin : 'https://x.com');
    if (!p || seen.has(p.id)) continue;
    if (handle && p.handle.toLowerCase() !== handle.toLowerCase() && p.quotedHandle?.toLowerCase() !== handle.toLowerCase()) continue;
    seen.add(p.id); out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

export type Route = { kind: 'home' | 'profile' | 'status' | 'search' | 'other'; handle: string | null; statusId: string | null };

/** SPA route classification for x.com URLs. */
export function parseRoute(href: string): Route {
  let u: URL;
  try { u = new URL(href); } catch { return { kind: 'other', handle: null, statusId: null }; }
  const p = u.pathname;
  if (p === '/home' || p === '/') return { kind: 'home', handle: null, statusId: null };
  if (p.startsWith('/search')) return { kind: 'search', handle: null, statusId: null };
  const s = STATUS_RE.exec(p);
  if (s) return { kind: 'status', handle: cleanHandle(s[1]), statusId: s[2] };
  const m = /^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|media|likes|highlights|articles|about))?\/?$/.exec(p);
  if (m && cleanHandle(m[1])) return { kind: 'profile', handle: m[1], statusId: null };
  return { kind: 'other', handle: null, statusId: null };
}
