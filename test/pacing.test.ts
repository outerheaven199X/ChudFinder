import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jitterGap, waitBeforeNext, capReached, bumpDaily, currentDaily, dayKey, nextLocalMidnight, clampDailyCap, DEFAULT_PACING } from '../src/shared/pacing.ts';
import { validate, exportCode, importCode } from '../src/shared/settings-schema.ts';

test('jitter: passive gaps stay within 4-9 s and vary', () => {
  const seen = new Set<number>();
  for (let i = 0; i < 2000; i++) { const g = jitterGap(); assert.ok(g >= 4000 && g <= 9000, String(g)); seen.add(g); }
  assert.ok(seen.size > 100, 'randomized');
  assert.equal(jitterGap(DEFAULT_PACING, () => 0), 4000); assert.equal(jitterGap(DEFAULT_PACING, () => 1), 9000);
  assert.equal(jitterGap(DEFAULT_PACING, () => 5), 9000);   // clamped
});

test('pacing: intent >= 2 s apart; passive capped at 10 per rolling minute', () => {
  const now = 1_000_000;
  assert.equal(waitBeforeNext('intent', now, [now - 500], 0), 1500);
  assert.equal(waitBeforeNext('intent', now, [now - 5000], 0), 0);
  assert.equal(waitBeforeNext('passive', now, [now - 1000], 6000), 5000);
  const ten = Array.from({ length: 10 }, (_, i) => now - 50_000 + i * 5000);   // 10 in the last 50 s
  const w = waitBeforeNext('passive', now, ten, 0);
  assert.ok(w >= 10_000, 'waits until the oldest of the 10 leaves the window: ' + w);
  // simulate an hour of passive lookups: never more than 10 in any 60 s window
  let t = 0; const log: number[] = [];
  for (let i = 0; i < 200; i++) { t += waitBeforeNext('passive', t, log, jitterGap()); log.push(t); }
  for (const a of log) assert.ok(log.filter(b => b >= a && b < a + 60e3).length <= 10);
});

test('daily cap: counts, enforces, resets at local midnight', () => {
  const t = new Date(2026, 9, 29, 23, 59, 0).getTime();
  let s = currentDaily(null, t);
  assert.deepEqual(s, { day: dayKey(t), count: 0 });
  for (let i = 0; i < 50; i++) s = bumpDaily(s, t);
  assert.equal(capReached(s, 50, t), true);
  assert.equal(capReached(s, 51, t), false);
  const mid = nextLocalMidnight(t);
  assert.equal(new Date(mid).getHours(), 0); assert.ok(mid > t && mid - t <= 60e3 + 1);
  assert.equal(capReached(s, 50, mid), false, 'new day resets');
  assert.equal(bumpDaily(s, mid).count, 1);
  assert.equal(clampDailyCap(5), 50); assert.equal(clampDailyCap(5000), 1000); assert.equal(clampDailyCap('x'), 300);
});

test('settings schema: lookupMode/dailyCap optional, bounded; old documents still valid', () => {
  const old = { schemaVersion: 1, homeCountry: 'United States', topicMode: true, highlightCountries: ['NG', 'IN'] };
  const r = validate(old); assert.ok(r.ok); assert.equal('lookupMode' in r.settings!, false);
  assert.ok(validate({ schemaVersion: 1, lookupMode: 'careful', dailyCap: 300 }).ok);
  assert.ok(validate({ schemaVersion: 1, lookupMode: 'auto', dailyCap: 1000 }).ok);
  assert.ok(!validate({ schemaVersion: 1, lookupMode: 'turbo' }).ok);
  for (const bad of [49, 1001, 300.5, '300', null]) assert.ok(!validate({ schemaVersion: 1, dailyCap: bad }).ok, String(bad));
  const back = importCode(exportCode({ lookupMode: 'auto', dailyCap: 120, highlightCountries: [] }));
  assert.ok(back.ok); assert.equal(back.settings!.lookupMode, 'auto'); assert.equal(back.settings!.dailyCap, 120);
});
