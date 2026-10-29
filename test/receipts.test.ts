import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertInvestigation } from '../src/shared/engine.ts';
import { buildExport, threadDraft, LIMITATIONS } from '../src/shared/receipts.ts';
import { obs, post, T0 } from './helpers.ts';

const inv = upsertInvestigation(null, obs('someone', { basedIn: 'Nigeria', accurate: false, source: 'United States App Store' },
  { profileLocation: { text: 'Lagos', observedAt: T0 }, posts: [post('5', 'someone', 'hello world this is a post')] }), T0);

test('JSON export contains the complete snapshot evidence and the limitations', () => {
  const ex = buildExport(inv, undefined, T0);
  const cited = new Set(ex.snapshot!.evidenceIds);
  assert.ok(ex.evidence.length > 0);
  for (const e of ex.evidence) assert.ok(cited.has(e.id));
  for (const id of cited) assert.ok(ex.evidence.some(e => e.id === id), 'every citation resolves inside the export');
  assert.deepEqual(ex.limitations, LIMITATIONS);
  assert.ok(ex.limitations.some(l => /No public permalink/.test(l)));
});

test('X thread draft: numbered, <= 280 chars each, labeled, sourced', () => {
  const t = threadDraft(inv);
  assert.ok(t.length >= 3);
  t.forEach((p, i) => { assert.ok(p.length <= 280, p); assert.ok(p.startsWith((i + 1) + '/' + t.length + ' ')); });
  assert.ok(t.some(p => p.includes('[reported]')));
  assert.ok(t.some(p => p.includes('Source: https://x.com/someone/about')));
  assert.ok(t[t.length - 1].includes('Bounded coverage'));
});
