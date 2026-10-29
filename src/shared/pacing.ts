/* Chud Finder - human-scale lookup pacing (pure functions, unit-tested).
 * Passive (auto-mode) lookups: randomized 4-9 s gaps and at most 10 per rolling minute.
 * User-intent lookups (hover, click, popover, Investigate): at most one per 2 s.
 * Daily cap shared by every tab, persisted in chrome.storage.local, resets at local midnight. */

export interface Pacing { passiveMinMs: number; passiveMaxMs: number; passivePerMinute: number; intentGapMs: number }
export const DEFAULT_PACING: Readonly<Pacing> = Object.freeze({ passiveMinMs: 4000, passiveMaxMs: 9000, passivePerMinute: 10, intentGapMs: 2000 });

export const LOOKUP_MODES = ['careful', 'auto'] as const;
export type LookupMode = typeof LOOKUP_MODES[number];
export const DEFAULT_LOOKUP_MODE: LookupMode = 'careful';
export const DAILY_CAP_MIN = 50, DAILY_CAP_MAX = 1000, DEFAULT_DAILY_CAP = 300;
export const HOVER_INTENT_MS = 600;

export function clampDailyCap(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_DAILY_CAP;
  return Math.min(DAILY_CAP_MAX, Math.max(DAILY_CAP_MIN, n));
}

/** Random gap for passive lookups, always within [min, max]. */
export function jitterGap(p: Pacing = DEFAULT_PACING, rand: () => number = Math.random): number {
  const r = Math.min(Math.max(rand(), 0), 1);
  return Math.round(p.passiveMinMs + r * (p.passiveMaxMs - p.passiveMinMs));
}

/**
 * How long to wait before the next request.
 * @param recent timestamps (ms) of requests already made (any kind)
 * @param plannedGap the jittered gap chosen for this passive request (ignored for intent)
 */
export function waitBeforeNext(kind: 'intent' | 'passive', now: number, recent: number[], plannedGap: number, p: Pacing = DEFAULT_PACING): number {
  const last = recent.length ? Math.max(...recent) : -Infinity;
  if (kind === 'intent') return Math.max(0, last + p.intentGapMs - now);
  let wait = Math.max(0, last + plannedGap - now);
  const inWindow = recent.filter(t => t > now - 60e3).sort((a, b) => a - b);
  if (inWindow.length >= p.passivePerMinute) {
    const oldest = inWindow[inWindow.length - p.passivePerMinute];
    wait = Math.max(wait, oldest + 60e3 - now + 1);
  }
  return wait;
}

export interface DailyState { day: string; count: number }
/** Local calendar day key, e.g. 2026-10-29. */
export function dayKey(t: number): string {
  const d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/** Next local midnight after t. */
export function nextLocalMidnight(t: number): number {
  const d = new Date(t); d.setHours(24, 0, 0, 0); return d.getTime();
}
export function currentDaily(state: DailyState | null | undefined, now: number): DailyState {
  const day = dayKey(now);
  return state && state.day === day && Number.isFinite(state.count) ? { day, count: state.count } : { day, count: 0 };
}
export function capReached(state: DailyState | null | undefined, cap: number, now: number): boolean {
  return currentDaily(state, now).count >= clampDailyCap(cap);
}
export function bumpDaily(state: DailyState | null | undefined, now: number): DailyState {
  const s = currentDaily(state, now); return { day: s.day, count: s.count + 1 };
}
