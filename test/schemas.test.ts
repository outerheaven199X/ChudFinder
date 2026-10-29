import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountObservation, Evidence, Finding, Investigation, Post, Export } from '../src/shared/schemas.ts';
import { upsertInvestigation } from '../src/shared/engine.ts';
import { buildExport } from '../src/shared/receipts.ts';
import { obs, post } from './helpers.ts';

test('observation schema accepts a valid observation', () => {
  assert.ok(AccountObservation.safeParse(obs('vllm_project', { basedIn: 'United States', accurate: true })).success);
});

test('observation schema rejects bad handles, http URLs, unknown keys and wrong types', () => {
  assert.ok(!AccountObservation.safeParse(obs('not a handle!', null)).success);
  assert.ok(!AccountObservation.safeParse({ ...obs('ok', null), pageUrl: 'http://x.com/ok' }).success);
  assert.ok(!AccountObservation.safeParse({ ...obs('ok', null), injected: true }).success);
  assert.ok(!AccountObservation.safeParse({ ...obs('ok', null), about: { basedIn: 1 } }).success);
  assert.ok(!Post.safeParse({ ...post('1', 'a', 'x'), url: 'javascript:alert(1)' }).success);
  assert.ok(!Post.safeParse({ ...post('1', 'a', 'x'), links: ['javascript:alert(1)'] }).success);
});

test('finding / evidence schemas enforce id prefixes and closed enums', () => {
  assert.ok(!Finding.safeParse({ id: 'x', capability: 'origin', title: 't', statement: 's', basis: 'reported', status: 'info', confidence: 'high', country: null, evidenceIds: [], caveats: [] }).success);
  assert.ok(!Finding.safeParse({ id: 'fd_1', capability: 'origin', title: 't', statement: 's', basis: 'certain', status: 'info', confidence: 'high', country: null, evidenceIds: [], caveats: [] }).success);
  assert.ok(!Evidence.safeParse({ id: 'ev_1', kind: 'about_based_in', source: 'server_fetch', subject: 'a', summary: '', value: {}, observedAt: '2026-01-01', firstSeenAt: '2026-01-01', lastSeenAt: '2026-01-01' }).success,
    'a server fetch is not a valid source: the extension never claims to have retrieved X data elsewhere');
});

test('investigation and export round-trip through their schemas', () => {
  const inv = upsertInvestigation(null, obs('jack', { basedIn: 'United States', accurate: true, source: 'United States App Store' }, { posts: [post('20', 'jack', 'just setting up my twttr')] }));
  const again = Investigation.parse(JSON.parse(JSON.stringify(inv)));
  assert.deepEqual(again, inv);
  const ex = buildExport(inv);
  assert.ok(Export.safeParse(JSON.parse(JSON.stringify(ex))).success);
});

import * as S from '../src/shared/settings-schema.ts';
test('settings schemaVersion 1: 1.2.0 documents stay valid; new popover / grokBotTemplateUrl keys validated', () => {
  const old = S.validate({ schemaVersion: 1, enabled: true, showName: true, askGrok: true, topicMode: true, homeCountry: 'US', highlightCountries: ['NG', 'India'] });
  assert.ok(old.ok); assert.deepEqual(old.warnings, []);
  const nu = S.validate({ schemaVersion: 1, popover: false, grokBotTemplateUrl: 'https://grok.com/templates/x' });
  assert.ok(nu.ok); assert.equal(nu.settings!.popover, false); assert.equal(nu.settings!.grokBotTemplateUrl, 'https://grok.com/templates/x');
  assert.ok(S.validate({ schemaVersion: 1, grokBotTemplateUrl: '' }).ok);
  assert.ok(!S.validate({ schemaVersion: 1, grokBotTemplateUrl: 'javascript:alert(1)' }).ok);
  assert.ok(!S.validate({ schemaVersion: 1, grokBotTemplateUrl: 'http://example.com' }).ok);
  assert.ok(!S.validate({ schemaVersion: 1, popover: 'yes' }).ok);
  const rt = S.importCode(S.exportCode({ popover: false, grokBotTemplateUrl: 'https://grok.com/t', homeCountry: 'US', highlightCountries: [] }));
  assert.ok(rt.ok); assert.equal(rt.settings!.popover, false); assert.equal(rt.settings!.grokBotTemplateUrl, 'https://grok.com/t');
});
