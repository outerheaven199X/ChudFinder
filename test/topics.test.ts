import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { topicTags, topicSignal } from '../src/shared/topics.ts';
import { renderTopicNote } from '../src/ext/lib.ts';
import { openPopover } from '../src/ext/popover.ts';

const BANNED = /\b(fearmonger\w*|misinformation|disinformation|propaganda|troll|bot farm|fake|liar|lying|agent|indian poster|foreign actor)\b/i;

test('topic tags: deterministic keyword regions, acronyms case-sensitive', () => {
  assert.deepEqual(topicTags('FEMA and the White House ignored the southern border again'), ['US']);
  assert.deepEqual(topicTags('Brussels and the EU migration pact will change everything'), ['EU']);
  assert.deepEqual(topicTags('Congress and the European Commission both voted'), ['US', 'EU']);
  assert.deepEqual(topicTags('Lok Sabha session extended'), ['IN']);
  assert.deepEqual(topicTags('ice cream at the beach'), []);            // "ice" is not ICE
  assert.deepEqual(topicTags('Good morning from Osaka'), []);
});

test('topic signal: exact neutral wording, inferred basis, mismatch only', () => {
  const s = topicSignal('The White House and Brussels are hiding the truth about the southern border and the EU migration pact', 'IN', 'India')!;
  assert.equal(s.basis, 'inferred'); assert.ok(s.mismatch);
  assert.equal(s.text, 'Post discusses US/EU topics \u00b7 X reports account based in India \u00b7 topic concentration only; no inference of misconduct.');
  assert.ok(!BANNED.test(s.text));
  assert.equal(topicSignal('FEMA response was slow', 'US', 'United States'), null);   // matches home
  assert.equal(topicSignal('EU budget talks', 'FR', 'France'), null);                // EU member
  assert.equal(topicSignal('nice sunset', 'IN', 'India'), null);                     // no topic
  assert.equal(topicSignal('FEMA', null, null), null);
  const d = topicSignal('Lok Sabha passes the bill', 'US', 'United States')!;
  assert.equal(d.text, 'Post discusses India topics \u00b7 X reports account based in United States \u00b7 topic concentration only; no inference of misconduct.');
});

test('topic note + popover row render with textContent only and stay neutral', () => {
  const doc = new JSDOM('<body><span id="a">x</span></body>', { pretendToBeVisual: true }).window.document;
  const sig = topicSignal('<img src=x onerror=alert(1)> FEMA', 'IN', 'India')!;
  const n = renderTopicNote(doc, sig);
  assert.equal(n.querySelector('img'), null);
  assert.match(n.textContent!, /^\[INFERRED\]Post discusses US topics/);
  assert.ok(!BANNED.test(n.textContent! + n.title));
  const pop = openPopover(doc, doc.getElementById('a')!, { handle: 'demo_x', info: { basedIn: 'India', accurate: true, source: 'India Android App' }, statedLocation: '',
    evaluation: { known: true, name: 'India', isRegion: false, warnings: [], flag: '' }, askGrok: false, topic: sig, onInvestigate() {}, onAskGrok() {} });
  const row = pop.querySelector('.cf-pop-topic')!;
  assert.ok(row && /topic concentration/.test(row.textContent!) && /\[INFERRED\]/.test(row.textContent!));
});
