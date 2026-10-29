/* Pure geography helpers shared by the badge code and the investigation engine. Country level only. */
import * as C from './countries.ts';
import { COUNTRY_UTC_OFFSETS } from './tz-offsets.ts';

export interface SourceInfo {
  platform: 'iOS' | 'Android' | 'Web' | null;
  country: string | null;
  raw: string | null;
}

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
  const t = C.norm(text);
  if (!t || t === 'georgia') return null;
  const parts = t
    .split(/[,|/·•]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates = new Set<string>();
  for (const part of parts) {
    const country = C.findCountry(part);
    const state = C.US_STATES.find(
      ([name, abbr]) =>
        part === name.toLowerCase() || (parts.length > 1 && part === abbr.toLowerCase()),
    );
    if (country && state && country.code !== 'US') return null;
    if (country) candidates.add(country.code);
    else if (state) candidates.add('US');
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function countryName(code: string | null): string | null {
  if (!code) return null;
  const c = C.COUNTRIES.find((x) => x.code === code);
  return c ? c.name : code;
}

export interface ActivityPattern {
  usable: boolean;
  posts: number;
  histogramUtc: number[];
  quietStartUtc: number | null;
  estOffsetHours: number | null;
  reason: string;
  dates: string[];
  start: string | null;
  end: string | null;
  missing: number;
  sensitivity: { label: string; posts: number; quietStarts: number[] }[];
  compatibleOffsets: number[];
}

/** Descriptive UTC histogram. Night-time compatibility is conditional, never geolocation. */
export function activityPattern(
  timestamps: string[],
  minimum = 24,
  minimumDays = 7,
): ActivityPattern {
  const ts = timestamps
    .map(Date.parse)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const hist = (xs: number[]) => {
    const h = Array(24).fill(0);
    for (const t of xs) h[new Date(t).getUTCHours()]++;
    return h;
  };
  const quiet = (xs: number[]) => {
    const h = hist(xs),
      sums = h.map((_, i) =>
        Array.from({ length: 6 }, (_, j) => h[(i + j) % 24]).reduce((a, b) => a + b, 0),
      );
    const min = Math.min(...sums);
    return xs.length && min <= xs.length * 0.1
      ? sums.flatMap((n, i) => (n === min ? [i] : []))
      : [];
  };
  const dates = [...new Set(ts.map((t) => new Date(t).toISOString().slice(0, 10)))];
  const middle = ts.length ? (ts[0] + ts[ts.length - 1]) / 2 : 0;
  const dailyCounts = new Map(
    dates.map((d) => [d, ts.filter((t) => new Date(t).toISOString().startsWith(d)).length]),
  );
  const median = [...dailyCounts.values()].sort((a, b) => a - b)[Math.floor(dates.length / 2)] || 0;
  const samples = [
    ['full window', ts],
    ['earlier half', ts.filter((t) => t <= middle)],
    ['later half', ts.filter((t) => t > middle)],
    [
      'lower activity days',
      ts.filter((t) => (dailyCounts.get(new Date(t).toISOString().slice(0, 10)) || 0) <= median),
    ],
  ] as [string, number[]][];
  const sensitivity = samples.map(([label, xs]) => ({
    label,
    posts: xs.length,
    quietStarts: quiet(xs),
  }));
  const candidates = quiet(ts),
    sufficient = ts.length >= minimum && dates.length >= minimumDays;
  const stable = sensitivity
    .slice(1)
    .every(
      (x) => x.posts >= Math.ceil(minimum / 3) && x.quietStarts.some((s) => candidates.includes(s)),
    );
  const usable = sufficient && candidates.length > 0 && stable;
  const offsets = [
    ...new Set(
      candidates.map((s) => {
        let v = 1 - s;
        while (v < -12) v += 24;
        while (v > 14) v -= 24;
        return v;
      }),
    ),
  ];
  return {
    usable,
    posts: ts.length,
    histogramUtc: hist(ts),
    quietStartUtc: candidates[0] ?? null,
    estOffsetHours: null,
    compatibleOffsets: usable ? offsets : [],
    dates,
    start: ts.length ? new Date(ts[0]).toISOString() : null,
    end: ts.length ? new Date(ts.at(-1)!).toISOString() : null,
    missing: timestamps.length - ts.length,
    sensitivity,
    reason: !sufficient
      ? `INSUFFICIENT SAMPLE: ${ts.length} posts on ${dates.length} dates; need ${minimum} posts on ${minimumDays} dates.`
      : !usable
        ? 'No stable quiet window across observation windows and activity levels.'
        : `Quiet six-hour windows start at UTC hours ${candidates.join(', ')}. Conditional night-time compatibility only; not a location estimate.`,
  };
}

/** Is a country's UTC offset range within +/-3h of an estimated offset? null when unknown. */
export function offsetConsistent(code: string, estOffsetHours: number): boolean | null {
  const r = COUNTRY_UTC_OFFSETS[code];
  if (!r) return null;
  const lo = estOffsetHours * 60 - 180,
    hi = estOffsetHours * 60 + 180;
  for (const shift of [-1440, 0, 1440]) if (r[0] + shift <= hi && r[1] + shift >= lo) return true;
  return false;
}

export function fmtOffset(h: number): string {
  return 'UTC' + (h >= 0 ? '+' : '\u2212') + Math.abs(h);
}
