import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { upsertInvestigation } from '../src/shared/engine.ts';
import { renderTab, TABS } from '../src/ext/render.ts';
import { obs, post, T0 } from './helpers.ts';

const XSS = '<img src=x onerror="globalThis.__pwned=1"><script>globalThis.__pwned=2</script><a href="javascript:alert(1)">click</a>';

function setup(botUrl = '') {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'chrome-extension://abc/src/sidepanel.html', runScripts: 'outside-only' });
  const inv = upsertInvestigation(null, obs('evil_acct', { basedIn: 'Brazil', accurate: false, source: 'Portugal App Store' }, {
    profileLocation: { text: XSS.slice(0, 120), observedAt: T0 },
    posts: [post('42', 'evil_acct', XSS + ' and a long enough claim text here', T0, { links: ['https://example.org/a'], quotedPostId: '41', quotedHandle: 'other' })],
    focusPostId: '42'
  }), T0);
  const actions: any[] = [];
  return { dom, inv, actions, ctx: { doc: dom.window.document, inv, grokBotTemplateUrl: botUrl, onAction: (a: any) => actions.push(a) } };
}

test('all five tabs render; untrusted text never becomes markup (XSS)', () => {
  const { dom, ctx } = setup();
  for (const t of TABS) {
    const node = renderTab(ctx, t, { evidenceAll: true });
    dom.window.document.body.appendChild(node);
    assert.equal(node.querySelectorAll('img,script,iframe,object').length, 0, t + ': no injected elements');
    for (const a of node.querySelectorAll('a')) assert.match(a.getAttribute('href')!, /^https:\/\//, t + ': only https links');
    for (const a of node.querySelectorAll('a')) assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
  }
  assert.equal((dom.window as any).__pwned, undefined);
  const claims = renderTab(ctx, 'Claims');
  assert.ok(claims.textContent!.includes('<img src=x onerror='), 'shown literally as text');
  dom.window.close();
});

test('panel shows labels, conflicts in amber, unknown states and no emoji', () => {
  const { ctx } = setup();
  const origin = renderTab(ctx, 'Origin');
  assert.ok(origin.querySelector('.tag.amber'), 'uncertainty is amber');
  assert.ok(origin.textContent!.includes('CONFLICTS'));
  assert.ok(origin.textContent!.includes('Location undetermined'));
  const all = TABS.map(t => renderTab(ctx, t).textContent).join('\n');
  assert.ok(!/\p{Extended_Pictographic}/u.test(all), 'no emoji in the panel');
  assert.ok(/reported/.test(all) && /self-described/.test(all) && /unknown/.test(all));
});

test('Narrative and Claims: observable data + Ask Grok per post; Grok Bot link only when configured', () => {
  const a = setup();
  const n = renderTab(a.ctx, 'Narrative');
  assert.ok(n.textContent!.includes('quotes')); assert.ok(n.textContent!.includes('example.org'));
  assert.ok(n.textContent!.includes('does not score coordination'));
  assert.equal(n.querySelectorAll('a.btn-link').length, 0, 'hidden when grokBotTemplateUrl is empty');
  const btn = n.querySelector('button[data-action="ask-grok"]') as HTMLButtonElement;
  btn.click();
  assert.match(a.actions[0].url, /^https:\/\/grok\.com\/\?q=/);
  assert.ok(decodeURIComponent(a.actions[0].url).includes('How is this narrative spreading'));
  const c = renderTab(a.ctx, 'Claims');
  assert.ok(c.textContent!.includes('unverified'));
  (c.querySelector('button[data-action="ask-grok"]') as HTMLButtonElement).click();
  assert.ok(decodeURIComponent(a.actions[1].url).includes('Identify the specific factual claims'));
  const b = setup('https://grok.example/templates/chud-finder');
  const links = renderTab(b.ctx, 'Claims').querySelectorAll('a.btn-link');
  assert.ok(links.length >= 1); assert.equal(links[0].getAttribute('href'), 'https://grok.example/templates/chud-finder');
  const bad = setup('javascript:alert(1)');
  assert.equal(renderTab(bad.ctx, 'Overview').querySelectorAll('a.btn-link').length, 0, 'non-https template URL is ignored');
});

test('evidence chips jump to stored evidence; every chip id exists', () => {
  const { ctx, inv, actions } = setup();
  const o = renderTab(ctx, 'Origin');
  const ids = new Set(inv.evidence.map(e => e.id));
  const chips = [...o.querySelectorAll('button.chip')] as HTMLButtonElement[];
  assert.ok(chips.length > 0);
  for (const ch of chips) assert.ok(ids.has(ch.textContent!), ch.textContent!);
  chips[0].click();
  assert.equal(actions[0].type, 'show-evidence');
});
