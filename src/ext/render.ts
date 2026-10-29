/* Side panel rendering. Pure DOM building with textContent only: untrusted strings (post text,
 * profile fields, URLs) can never become markup. Tested in jsdom. */
import { currentSnapshot } from '../shared/engine.ts';
import { claimPrompt, grokUrl, narrativePrompt, originPrompt } from '../shared/prompts.ts';
import { safeHttpsUrl } from '../shared/sanitize.ts';
import type { Evidence, Finding, Investigation, Post, Snapshot } from '../shared/schemas.ts';

export const TABS = ['Overview', 'Origin', 'Narrative', 'Claims', 'Evidence'] as const;
export type Tab = typeof TABS[number];

export interface RenderCtx {
  doc: Document; inv: Investigation; version?: number; grokBotTemplateUrl?: string;
  onAction?: (a: { type: string; [k: string]: unknown }) => void;
}

const SOURCE_LABEL: Record<string, string> = {
  x_about_account: 'X About this account (your session)', x_profile: 'X profile (self-described)',
  x_page_dom: 'On-page (DOM)', x_graphql: 'X timeline data (your session)', derived: 'Derived by Chud Finder'
};

export function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string | null): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function link(doc: Document, href: string, text: string): HTMLElement {
  const safe = safeHttpsUrl(href);
  if (!safe) return el(doc, 'span', 'mono', text);
  const a = el(doc, 'a', 'ext', text);
  a.href = safe; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}

function button(ctx: RenderCtx, label: string, action: { type: string; [k: string]: unknown }, cls = 'btn'): HTMLButtonElement {
  const b = el(ctx.doc, 'button', cls, label);
  b.type = 'button';
  b.dataset.action = action.type;
  b.addEventListener('click', () => ctx.onAction && ctx.onAction(action));
  return b;
}

function grokBotLink(ctx: RenderCtx): HTMLElement | null {
  const u = ctx.grokBotTemplateUrl ? safeHttpsUrl(ctx.grokBotTemplateUrl) : null;
  if (!u) return null;
  const a = link(ctx.doc, u, 'Deep investigation with Chud Finder Grok Bot');
  a.classList.add('btn', 'btn-link');
  return a;
}

function tag(doc: Document, basis: string, status?: string): HTMLElement {
  const uncertain = basis === 'inferred' || basis === 'unknown' || status === 'conflict' || status === 'undetermined';
  return el(doc, 'span', 'tag mono' + (uncertain ? ' amber' : ''), basis + (status && status !== 'info' ? ' \u00b7 ' + status : ''));
}

function findingCard(ctx: RenderCtx, f: Finding, evidence: Map<string, Evidence>): HTMLElement {
  const d = ctx.doc;
  const c = el(d, 'section', 'card finding' + (f.status === 'conflict' ? ' conflict' : ''));
  c.dataset.findingId = f.id;
  const h = el(d, 'div', 'card-head');
  h.append(el(d, 'span', 'card-title', f.title), tag(d, f.basis, f.status));
  c.appendChild(h);
  c.appendChild(el(d, 'p', 'statement', f.statement));
  const meta = el(d, 'div', 'meta mono', 'confidence: ' + f.confidence + (f.country ? ' \u00b7 country: ' + f.country : ''));
  c.appendChild(meta);
  for (const cv of f.caveats) c.appendChild(el(d, 'p', 'caveat', cv));
  if (f.evidenceIds.length) {
    const refs = el(d, 'div', 'refs');
    const MAX_CHIPS = 6;
    for (const id of f.evidenceIds.slice(0, MAX_CHIPS)) {
      const e = evidence.get(id);
      const chip = button(ctx, id, { type: 'show-evidence', id }, 'chip mono');
      chip.title = e ? e.summary : 'missing evidence';
      refs.appendChild(chip);
    }
    if (f.evidenceIds.length > MAX_CHIPS) refs.appendChild(button(ctx, '+' + (f.evidenceIds.length - MAX_CHIPS) + ' more', { type: 'show-evidence', id: f.evidenceIds[MAX_CHIPS] }, 'chip mono'));
    c.appendChild(refs);
  }
  return c;
}

function kv(doc: Document, rows: [string, string | null, string?][]): HTMLElement {
  const t = el(doc, 'dl', 'kv');
  for (const [k, v, note] of rows) {
    t.appendChild(el(doc, 'dt', 'mono', k));
    const dd = el(doc, 'dd', v ? '' : 'na', v || 'Unavailable');
    if (note) dd.appendChild(el(doc, 'span', 'note', ' ' + note));
    t.appendChild(dd);
  }
  return t;
}

function evidenceMap(inv: Investigation) { return new Map(inv.evidence.map(e => [e.id, e])); }

function overview(ctx: RenderCtx, s: Snapshot): HTMLElement {
  const d = ctx.doc; const root = el(d, 'div', 'pane');
  root.appendChild(el(d, 'p', 'headline', s.headline));
  const a = s.account;
  root.appendChild(kv(d, [
    ['based in', a.basedIn ? a.basedIn + (a.basedInIsRegion ? ' (region)' : '') : null, a.basedIn ? 'reported by X' : undefined],
    ['connected via', a.connectedVia, a.connectedVia ? 'reported by X' : undefined],
    ['location note', a.locationAccurate === false ? 'X: may not be accurate (VPN/proxy)' : a.locationAccurate === true ? 'none' : null],
    ['profile loc.', a.profileLocation, a.profileLocation ? 'self-described' : undefined],
    ['observed', a.aboutObservedAt ? new Date(a.aboutObservedAt).toLocaleString() : null]
  ]));
  const ev = evidenceMap(ctx.inv);
  const region = s.findings.find(f => f.title === 'Likely operating region');
  if (region) root.appendChild(findingCard(ctx, region, ev));
  const conflicts = s.findings.filter(f => f.status === 'conflict');
  root.appendChild(el(d, 'p', 'meta mono', s.findings.length + ' findings \u00b7 ' + conflicts.length + ' conflicts \u00b7 ' + s.evidenceIds.length + ' evidence \u00b7 ' + s.posts.length + ' posts observed \u00b7 v' + s.version));
  const acts = el(d, 'div', 'actions');
  acts.append(button(ctx, 'Ask Grok about @' + a.handle, { type: 'ask-grok', url: grokUrl(originPrompt(s)) }));
  const gb = grokBotLink(ctx); if (gb) acts.appendChild(gb);
  root.appendChild(acts);
  const rc = el(d, 'section', 'card');
  rc.appendChild(el(d, 'div', 'card-title', 'Receipts'));
  rc.appendChild(el(d, 'p', 'caveat', 'Built from this local evidence snapshot only. No public permalink (there is no server).'));
  const ra = el(d, 'div', 'actions');
  ra.append(button(ctx, 'PNG card', { type: 'export-png' }), button(ctx, 'JSON', { type: 'export-json' }), button(ctx, 'X thread draft', { type: 'thread' }));
  rc.appendChild(ra);
  root.appendChild(rc);
  return root;
}

function origin(ctx: RenderCtx, s: Snapshot): HTMLElement {
  const d = ctx.doc; const root = el(d, 'div', 'pane'); const ev = evidenceMap(ctx.inv);
  root.appendChild(el(d, 'h2', 'sec mono', 'ORIGIN X-RAY'));
  for (const f of s.findings.filter(f => f.capability === 'origin')) root.appendChild(findingCard(ctx, f, ev));
  root.appendChild(el(d, 'h2', 'sec mono', 'VPN DETECTIVE'));
  const vpn = s.findings.filter(f => f.capability === 'vpn');
  const conflicts = vpn.filter(f => f.status === 'conflict');
  if (conflicts.length) {
    const ul = el(d, 'ul', 'conflicts');
    for (const f of conflicts) ul.appendChild(el(d, 'li', '', f.statement));
    root.appendChild(el(d, 'div', 'meta mono amber', 'CONFLICTS (' + conflicts.length + ')'));
    root.appendChild(ul);
  }
  for (const f of vpn) root.appendChild(findingCard(ctx, f, ev));
  return root;
}

function postCard(ctx: RenderCtx, p: Post, extra?: HTMLElement[]): HTMLElement {
  const d = ctx.doc; const c = el(d, 'section', 'card post');
  const h = el(d, 'div', 'card-head');
  h.append(el(d, 'span', 'mono', '@' + p.handle), el(d, 'span', 'mono meta', p.createdAt ? new Date(p.createdAt).toLocaleString() : 'time unknown'));
  c.appendChild(h);
  c.appendChild(el(d, 'p', 'post-text', p.text || '(no text captured)'));
  const m = el(d, 'div', 'meta');
  m.appendChild(link(d, p.url, 'open post'));
  if (p.lang) m.appendChild(el(d, 'span', 'mono', ' \u00b7 lang ' + p.lang));
  m.appendChild(el(d, 'span', 'mono', ' \u00b7 ' + (p.capturedFrom === 'x_page_dom' ? 'from page' : 'from X timeline data')));
  c.appendChild(m);
  if (p.links.length) {
    const ul = el(d, 'ul', 'links');
    for (const l of p.links) { const li = el(d, 'li'); li.appendChild(link(d, l, l)); ul.appendChild(li); }
    c.appendChild(ul);
  }
  for (const x of extra || []) c.appendChild(x);
  return c;
}

function orderedPosts(s: Snapshot): Post[] {
  const own = s.posts.filter(p => p.handle.toLowerCase() === s.account.handle.toLowerCase());
  const focus = s.focusPostId ? own.find(p => p.id === s.focusPostId) : undefined;
  const rest = own.filter(p => p !== focus).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return focus ? [focus, ...rest] : rest;
}

function narrative(ctx: RenderCtx, s: Snapshot): HTMLElement {
  const d = ctx.doc; const root = el(d, 'div', 'pane');
  root.appendChild(el(d, 'h2', 'sec mono', 'NARRATIVE'));
  root.appendChild(el(d, 'p', 'caveat', 'Observed on the page only. The extension does not score coordination; use Ask Grok or the Grok Bot for a narrative analysis and treat it as a hypothesis.'));
  const edges = s.edges;
  if (edges.length) {
    const t = el(d, 'table', 'edges');
    const hr = el(d, 'tr'); for (const x of ['from', 'relation', 'to']) hr.appendChild(el(d, 'th', 'mono', x)); t.appendChild(hr);
    for (const e of edges.slice(0, 60)) {
      const tr = el(d, 'tr');
      tr.appendChild(el(d, 'td', 'mono', e.from.replace(/^post:/, '')));
      tr.appendChild(el(d, 'td', 'mono', e.type.replace('_', ' ')));
      const td = el(d, 'td', 'mono'); if (e.type === 'links_to') td.appendChild(link(d, e.to, e.to)); else td.textContent = e.to.replace(/^(post|account):/, '');
      tr.appendChild(td); t.appendChild(tr);
    }
    root.appendChild(t);
  } else root.appendChild(el(d, 'p', 'na', 'No quotes, replies or links observed.'));
  const posts = orderedPosts(s);
  if (!posts.length) root.appendChild(el(d, 'p', 'na', 'No posts by this account were observed. Open its profile or a post and click Refresh.'));
  root.appendChild(el(d, 'div', 'meta mono', 'TIMELINE (' + posts.length + ' observed posts)'));
  for (const p of posts.slice(0, 25)) {
    const acts = el(d, 'div', 'actions');
    acts.appendChild(button(ctx, 'Ask Grok: how is this spreading?', { type: 'ask-grok', url: grokUrl(narrativePrompt(p, edges.filter(e => e.from === 'post:' + p.id))) }));
    const gb = grokBotLink(ctx); if (gb) acts.appendChild(gb);
    root.appendChild(postCard(ctx, p, [acts]));
  }
  return root;
}

function claims(ctx: RenderCtx, s: Snapshot): HTMLElement {
  const d = ctx.doc; const root = el(d, 'div', 'pane');
  root.appendChild(el(d, 'h2', 'sec mono', 'CLAIMS'));
  root.appendChild(el(d, 'p', 'caveat', 'Claim candidates are the observed post text. Nothing here is verified by the extension; status stays \u201cunverified\u201d until you check sources.'));
  const byId = new Map(s.posts.map(p => [p.id, p]));
  if (!s.claims.length) root.appendChild(el(d, 'p', 'na', 'No claim candidates observed (no posts with text by this account).'));
  const ordered = [...s.claims].sort((a, b) => (a.postId === s.focusPostId ? -1 : b.postId === s.focusPostId ? 1 : 0));
  for (const c of ordered) {
    const p = byId.get(c.postId); if (!p) continue;
    const acts = el(d, 'div', 'actions');
    acts.append(el(d, 'span', 'tag mono amber', c.status), button(ctx, 'Ask Grok: verify this claim', { type: 'ask-grok', url: grokUrl(claimPrompt(p)) }));
    const gb = grokBotLink(ctx); if (gb) acts.appendChild(gb);
    root.appendChild(postCard(ctx, p, [acts]));
  }
  return root;
}

function evidenceTab(ctx: RenderCtx, s: Snapshot, all: boolean): HTMLElement {
  const d = ctx.doc; const root = el(d, 'div', 'pane');
  const inSnap = new Set(s.evidenceIds);
  const list = ctx.inv.evidence.filter(e => all || inSnap.has(e.id)).sort((a, b) => a.kind.localeCompare(b.kind) || b.lastSeenAt.localeCompare(a.lastSeenAt));
  const h = el(d, 'div', 'card-head');
  h.append(el(d, 'h2', 'sec mono', 'EVIDENCE (' + list.length + (all ? ', full history' : ', this version') + ')'),
    button(ctx, all ? 'This version' : 'Full history', { type: 'evidence-scope', all: !all }, 'btn small'));
  root.appendChild(h);
  for (const e of list) {
    const c = el(d, 'section', 'card evidence'); c.id = 'evidence-' + e.id; c.dataset.evidenceId = e.id;
    const hh = el(d, 'div', 'card-head'); hh.append(el(d, 'span', 'mono', e.id), el(d, 'span', 'tag mono' + (e.source === 'derived' ? ' amber' : ''), e.kind));
    c.appendChild(hh);
    c.appendChild(el(d, 'p', 'statement', e.summary));
    c.appendChild(el(d, 'div', 'meta mono', 'source: ' + (SOURCE_LABEL[e.source] || e.source)));
    c.appendChild(el(d, 'div', 'meta mono', 'observed ' + new Date(e.observedAt).toLocaleString() + ' \u00b7 first ' + new Date(e.firstSeenAt).toLocaleDateString() + ' \u00b7 last ' + new Date(e.lastSeenAt).toLocaleDateString()));
    if (e.derivedFrom && e.derivedFrom.length) c.appendChild(el(d, 'div', 'meta mono', 'derived from ' + e.derivedFrom.length + ' items'));
    if (e.url) { const m = el(d, 'div', 'meta'); m.appendChild(link(d, e.url, e.url)); c.appendChild(m); }
    root.appendChild(c);
  }
  return root;
}

export function renderTab(ctx: RenderCtx, tabName: Tab, opts: { evidenceAll?: boolean } = {}): HTMLElement {
  const s = currentSnapshot(ctx.inv, ctx.version);
  switch (tabName) {
    case 'Overview': return overview(ctx, s);
    case 'Origin': return origin(ctx, s);
    case 'Narrative': return narrative(ctx, s);
    case 'Claims': return claims(ctx, s);
    case 'Evidence': return evidenceTab(ctx, s, !!opts.evidenceAll);
  }
}
