/* Untrusted text handling. Post text, display names and profile fields come from other people and
 * are only ever treated as data: rendered with textContent, and quoted (never interpolated as
 * instructions) when building Ask Grok prompts.
 */
// C0/C1 controls (except \n\t), zero-width chars, bidi overrides/isolates, BOM.
const STRIP_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

export function cleanText(input: unknown, max = 1000): string {
  let s = typeof input === 'string' ? input : input == null ? '' : String(input);
  s = s.normalize('NFKC').replace(STRIP_RE, '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '\u2026';
  return s;
}

/** Quote untrusted text for a prompt: one line, no delimiter breakouts, clearly marked as data. */
export function quoteForPrompt(input: unknown, max = 500): string {
  const s = cleanText(input, max).replace(/\s*\n\s*/g, ' / ')
    .replace(/"""/g, '\u201d\u201d\u201d').replace(/<<|>>/g, m => (m === '<<' ? '\u00ab' : '\u00bb'));
  return '<<' + s + '>>';
}

/** Only keep https links; drop javascript:, data:, credentials, and anything unparsable. */
export function safeHttpsUrl(input: unknown): string | null {
  try {
    const u = new URL(String(input || ''));
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.href.length <= 2048 ? u.href : null;
  } catch { return null; }
}

/** Phrases the extension's own generated text must never contain (boundary guard). */
const FORBIDDEN = [
  /\bnationality\b/i, /\bethnic(ity)?\b/i, /\b(mis|dis)information (source|country|account)s?\b/i,
  /\b(is|are) (a )?(foreign )?(agent|bot farm|troll farm)s?\b/i, /\bhome address\b/i, /\b(street|neighbou?rhood|zip code|postcode)\b/i
];
export function violatesBoundaries(text: string): string | null {
  for (const re of FORBIDDEN) if (re.test(text)) return re.source;
  return null;
}
