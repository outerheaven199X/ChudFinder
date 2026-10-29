// Demo side panel for the fictional @demo_borderdesk account (demo data). Uses the real engine + renderer.
import { upsertInvestigation } from '../src/shared/engine.ts';
import { renderTab } from '../src/ext/render.ts';
import type { Tab } from '../src/ext/render.ts';
const T0 = '2026-10-29T16:00:00.000Z';
const texts = ['The White House and Brussels are hiding what is really happening at the southern border. The EU migration pact is next. Share before it\u2019s gone.',
  'Congress will not tell you this about FEMA.', 'Brussels again.', 'Morning update', 'Thread on the border numbers'];
const posts = Array.from({ length: 24 }, (_, i) => ({ id: String(7000 + i), handle: 'demo_borderdesk', url: 'https://x.com/demo_borderdesk/status/' + (7000 + i),
  text: texts[i % texts.length], createdAt: new Date(Date.UTC(2026, 9, 2 + (i % 20), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14][i % 12], 10)).toISOString(), lang: 'en',
  links: [], quotedPostId: null, quotedHandle: null, replyToHandle: null, capturedFrom: 'x_page_dom' as const }));
const inv = upsertInvestigation(null, { handle: 'demo_borderdesk', observedAt: T0, pageUrl: 'https://x.com/demo_borderdesk', adapterVersion: 'x-dom@2026-10.1',
  about: { basedIn: 'India', accurate: true, source: 'India Android App', notFound: false, observedAt: T0 },
  profileLocation: { text: 'Texas, USA', observedAt: T0 }, posts, focusPostId: '7000' }, T0);
const mode = (location.hash.slice(1) || 'Overview') as Tab;
const nav = document.getElementById('tabs')!;
for (const t of ['Overview', 'Origin', 'Narrative', 'Claims', 'Evidence']) {
  const b = document.createElement('button'); b.className = 'tab mono' + (t === mode ? ' active' : ''); b.textContent = t.toUpperCase(); nav.appendChild(b);
}
document.getElementById('main')!.appendChild(renderTab({ doc: document, inv, grokBotTemplateUrl: '' }, mode));
