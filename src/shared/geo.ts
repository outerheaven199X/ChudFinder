/* Pure geography helpers shared by the badge code and the investigation engine. Country level only. */
import * as C from './countries.ts';
import { COUNTRY_UTC_OFFSETS } from './tz-offsets.ts';

export interface SourceInfo { platform: 'iOS' | 'Android' | 'Web' | null; country: string | null; raw: string | null }

/** Classify X's about_profile.source, e.g. "Japan App Store", "Russian Federation Android App", "Web". */
export function classifySource(source: unknown): SourceInfo {
  const raw = typeof source === 'string' && source.trim() ? source.trim() : null;
  if (!raw) return { platform: null, country: null, raw: null };
  let m = /^(.*?)\s*app\s+store$/i.exec(raw);
  if (m) return { platform: 'iOS', country: m[1].trim() || null, raw };
  m = /^(.*?)\s*android\s+app$/i.exec(raw);
  if (m) return { platform: 'Android', country: m[1].trim() || null, raw };
  if (/^web$/i.test(raw)) return { platform: 'Web', country: null, raw };
  return { platform: null, country: null, raw };
}

/** Best-effort: which country does a free-text profile location point at? Returns ISO2 or null. */
export function countryFromStatedLocation(text: unknown): string | null {
  if (!text) return null;
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

export function countryName(code: string | null): string | null {
  if (!code) return null;
  const c = C.COUNTRIES.find(x => x.code === code);
  return c ? c.name : code;
}

export interface ActivityPattern {
  usable: boolean; posts: number; histogramUtc: number[];
  quietStartUtc: number | null; estOffsetHours: number | null; reason: string;
}

/** Hour-of-day activity from post timestamps. Estimates a UTC offset band (+/-3h) by assuming the
 * quietest 6-hour window is local night (centred ~04:00). Weak signal; never used alone. */
export function activityPattern(timestamps: string[]): ActivityPattern {
  const hist = new Array(24).fill(0);
  const ts = [...new Set(timestamps)].map(t => Date.parse(t)).filter(n => !Number.isNaN(n));
  for (const t of ts) hist[new Date(t).getUTCHours()]++;
  const n = ts.length;
  const base = { posts: n, histogramUtc: hist };
  if (n < 12) return { ...base, usable: false, quietStartUtc: null, estOffsetHours: null, reason: 'Needs at least 12 timestamped posts; ' + n + ' observed.' };
  let best = 0, bestSum = Infinity;
  for (let s = 0; s < 24; s++) {
    let sum = 0;
    for (let k = 0; k < 6; k++) sum += hist[(s + k) % 24];
    if (sum < bestSum) { bestSum = sum; best = s; }
  }
  if (bestSum > n * 0.1) return { ...base, usable: false, quietStartUtc: best, estOffsetHours: null, reason: 'No clear quiet period (posts are spread across the day).' };
  let off = 4 - (best + 3);            // local 04:00 at the middle of the quiet window
  while (off < -12) off += 24;
  while (off > 14) off -= 24;
  return { ...base, usable: true, quietStartUtc: best, estOffsetHours: off, reason: 'Quietest 6 hours start at ' + String(best).padStart(2, '0') + ':00 UTC.' };
}

/** Is a country's UTC offset range within +/-3h of an estimated offset? null when unknown. */
export function offsetConsistent(code: string, estOffsetHours: number): boolean | null {
  const r = COUNTRY_UTC_OFFSETS[code];
  if (!r) return null;
  const lo = estOffsetHours * 60 - 180, hi = estOffsetHours * 60 + 180;
  for (const shift of [-1440, 0, 1440]) if (r[0] + shift <= hi && r[1] + shift >= lo) return true;
  return false;
}

export function fmtOffset(h: number): string {
  return 'UTC' + (h >= 0 ? '+' : '\u2212') + Math.abs(h);
}
