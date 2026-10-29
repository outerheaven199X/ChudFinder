// Fixture harness for screenshots (tools/shots/shoot.sh). Renders real extension UI code with a
// fixture investigation; nothing here talks to X. Mode is chosen by location.hash.
import { upsertInvestigation } from '../../src/shared/engine.ts';
import { renderBadge, evaluate } from '../../src/ext/lib.ts';
import { openPopover } from '../../src/ext/popover.ts';
import { renderTab } from '../../src/ext/render.ts';
import type { Tab } from '../../src/ext/render.ts';
import { drawReceipt, receiptFontsReady } from '../../src/ext/receipt-png.ts';
import { threadDraft } from '../../src/shared/receipts.ts';

const T0 = '2026-10-29T15:00:00.000Z';
const posts = Array.from({ length: 30 }, (_, i) => {
  const h = [6, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21][i % 14];
  return { id: String(9000 + i), handle: 'sample_acct', url: 'https://x.com/sample_acct/status/' + (9000 + i),
    text: i === 0 ? 'BREAKING: officials confirmed the bridge closure will last until 2027, according to the city transport report https://example.org/report' : 'Update ' + i + ' on the transit story',
    createdAt: new Date(Date.UTC(2026, 9, 1 + (i % 25), h, 5)).toISOString(), lang: 'en',
    links: i === 0 ? ['https://example.org/report'] : [], quotedPostId: i === 0 ? '8888' : null, quotedHandle: i === 0 ? 'citydesk' : null,
    replyToHandle: i === 3 ? 'someone_else' : null, capturedFrom: 'x_page_dom' as const };
});
const inv = upsertInvestigation(null, {
  handle: 'sample_acct', observedAt: T0, pageUrl: 'https://x.com/sample_acct', adapterVersion: 'x-dom@2026-10.1',
  about: { basedIn: 'Nigeria', accurate: false, source: 'United States App Store', notFound: false, observedAt: T0 },
  profileLocation: { text: 'Dallas, TX', observedAt: T0 }, posts, focusPostId: '9000'
}, T0);

const mode = location.hash.slice(1) || 'Overview';
document.body.className = 'm-' + mode;
if (mode === 'popover') {
  const info = { basedIn: 'Nigeria', accurate: false, source: 'United States App Store', t: Date.parse(T0) };
  const row = document.getElementById('row')!;
  const badge = renderBadge(document, info, {}, 'Dallas, TX', 'sample_acct', () => {});
  row.appendChild(badge);
  const ok = renderBadge(document, { basedIn: 'Japan', accurate: true, source: 'Japan App Store' }, {}, '', 'other', () => {});
  document.getElementById('row2')!.appendChild(ok);
  openPopover(document, badge, { handle: 'sample_acct', info, statedLocation: 'Dallas, TX', evaluation: evaluate(info, {}, 'Dallas, TX'),
    askGrok: true, onInvestigate() {}, onAskGrok() {} });
} else if (mode === 'png') {
  const c = document.createElement('canvas'); c.style.width = '1200px'; document.body.appendChild(c);
  void receiptFontsReady().then(() => drawReceipt(c, inv));
} else if (mode === 'thread') {
  const pre = document.createElement('pre'); pre.textContent = threadDraft(inv).join('\n\n'); document.getElementById('main')!.appendChild(pre);
} else {
  const nav = document.getElementById('tabs')!;
  for (const t of ['Overview', 'Origin', 'Narrative', 'Claims', 'Evidence']) {
    const b = document.createElement('button'); b.className = 'tab mono' + (t === mode ? ' active' : ''); b.textContent = t.toUpperCase(); nav.appendChild(b);
  }
  document.getElementById('main')!.appendChild(renderTab({ doc: document, inv, grokBotTemplateUrl: 'https://grok.com/' }, mode as Tab));
}
