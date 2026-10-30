/* Side panel rendering. Pure DOM building with textContent only: untrusted strings (post text,
 * profile fields, URLs) can never become markup. Tested in jsdom. */
import { currentSnapshot } from '../shared/engine.ts';
import { claimPrompt, grokUrl, narrativePrompt, originPrompt } from '../shared/prompts.ts';
import { safeHttpsUrl } from '../shared/sanitize.ts';
import type {
  Evidence,
  Finding,
  Investigation,
  Post,
  Snapshot,
  MediaObservation,
} from '../shared/schemas.ts';

export const TABS = ['Overview', 'Origin', 'Narrative', 'Claims', 'Evidence'] as const;
export type Tab = (typeof TABS)[number];

export interface RenderCtx {
  doc: Document;
  inv: Investigation;
  version?: number;
  grokBotTemplateUrl?: string;
  onAction?: (a: { type: string; [k: string]: unknown }) => void;
}

const SOURCE_LABEL: Record<string, string> = {
  x_about_account: 'Legacy About observation (retained history)',
  x_profile: 'X profile (self-described)',
  x_page_dom: 'On-page (DOM)',
  x_graphql: 'Legacy timeline observation (retained history)',
  x_official: 'Approved X API',
  user_evidence: 'User-provided observation',
  public_evidence: 'Public external source',
  derived: 'Derived by Chud Finder',
};

export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  cls?: string,
  text?: string | null,
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function link(doc: Document, href: string, text: string): HTMLElement {
  const safe = safeHttpsUrl(href);
  if (!safe) return el(doc, 'span', 'mono', text);
  const a = el(doc, 'a', 'ext', text);
  a.href = safe;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function button(
  ctx: RenderCtx,
  label: string,
  action: { type: string; [k: string]: unknown },
  cls = 'btn',
): HTMLButtonElement {
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
  const uncertain =
    basis === 'inferred' ||
    basis === 'unknown' ||
    status === 'conflict' ||
    status === 'undetermined';
  return el(
    doc,
    'span',
    'tag mono' + (uncertain ? ' amber' : ''),
    basis + (status && status !== 'info' ? ' \u00b7 ' + status : ''),
  );
}

function findingCard(ctx: RenderCtx, f: Finding, evidence: Map<string, Evidence>): HTMLElement {
  const d = ctx.doc;
  const c = el(d, 'section', 'card finding' + (f.status === 'conflict' ? ' conflict' : ''));
  c.dataset.findingId = f.id;
  const h = el(d, 'div', 'card-head');
  h.append(el(d, 'span', 'card-title', f.title), tag(d, f.basis, f.status));
  c.appendChild(h);
  c.appendChild(el(d, 'p', 'statement', f.statement));
  const meta = el(
    d,
    'div',
    'meta mono',
    'EVIDENCE STRENGTH ' + (f.country ? ' \u00b7 country: ' + f.country : ''),
  );
  c.appendChild(meta);
  if (f.strength) meta.title = f.strength.reasons.join(' ');
  const bars = el(d, 'span', 'strength');
  bars.setAttribute('aria-label', (f.strength?.bars || 1) + ' of 3 bars');
  for (let i = 1; i <= 3; i++) {
    const bar = el(d, 'i', i <= (f.strength?.bars || 1) ? 'lit' : '');
    bar.style.height = 5 + i * 4 + 'px';
    bars.appendChild(bar);
  }
  meta.appendChild(bars);
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
    if (f.evidenceIds.length > MAX_CHIPS)
      refs.appendChild(
        button(
          ctx,
          '+' + (f.evidenceIds.length - MAX_CHIPS) + ' more',
          { type: 'show-evidence', id: f.evidenceIds[MAX_CHIPS] },
          'chip mono',
        ),
      );
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

function evidenceMap(inv: Investigation) {
  return new Map(inv.evidence.map((e) => [e.id, e]));
}

function overview(ctx: RenderCtx, s: Snapshot): HTMLElement {
  const d = ctx.doc;
  const root = el(d, 'div', 'pane');
  if (s.coverage?.some((c) => c.provider === 'SyntheticFixture'))
    root.appendChild(
      el(d, 'p', 'card-title amber', 'SYNTHETIC ACCEPTANCE FIXTURE / NOT A LIVE INVESTIGATION'),
    );
  root.appendChild(el(d, 'p', 'headline', s.headline));
  const about=el(d,'p','caveat');
  about.append(link(d,'https://x.com/'+encodeURIComponent(ctx.inv.subject.handle)+'/about','Open X About'),d.createTextNode(' to capture or update the displayed country. Saved flags then appear automatically.'));
  root.appendChild(about);
  const ev = evidenceMap(ctx.inv);
  for (const section of s.story || []) {
    const details = el(d, 'details', 'card story-section');
    details.open = true;
    details.appendChild(el(d, 'summary', 'card-title mono', section.title));
    if (section.title.startsWith('07')) details.appendChild(el(d, 'p', 'post-text', section.text));
    else
      for (const id of section.findingIds) {
        const f = s.findings.find((f) => f.id === id);
        if (f) details.appendChild(findingCard(ctx, f, ev));
      }
    if (section.title.startsWith('03')) {
      const activity = ctx.inv.evidence.find(
        (e) => s.evidenceIds.includes(e.id) && e.kind === 'activity_pattern',
      );
      if (activity) {
        const histogram = el(d, 'div', 'histogram');
        histogram.setAttribute('aria-label', 'UTC activity histogram');
        const values = activity.value.histogramUtc as number[],
          max = Math.max(1, ...values);
        values.forEach((n, h) => {
          const bar = el(d, 'div', 'hour');
          bar.title = String(h).padStart(2, '0') + ':00 UTC: ' + n + ' posts';
          bar.style.height = 10 + (60 * n) / max + 'px';
          bar.appendChild(el(d, 'span', 'mono', String(h)));
          histogram.appendChild(bar);
        });
        details.appendChild(histogram);
        details.appendChild(
          el(
            d,
            'p',
            'meta',
            `Dates: ${(activity.value.dates as string[]).join(', ')}. Missing timestamps: ${activity.value.missing}.`,
          ),
        );
        details.appendChild(
          el(d, 'pre', 'meta', JSON.stringify(activity.value.sensitivity, null, 2)),
        );
      }
    }
    if (section.title.startsWith('04')) {
      const w = ctx.inv.evidence.find(
        (e) => s.evidenceIds.includes(e.id) && e.kind === 'writing_pattern',
      );
      for (const change of (w?.value.changes || []) as any[]) {
        const pair = el(d, 'div', 'card');
        pair.appendChild(el(d, 'p', 'mono', change.feature));
        for (const id of [change.before, change.after]) {
          const p = s.posts.find((p) => p.id === id);
          if (p) pair.appendChild(postCard(ctx, p));
        }
        details.appendChild(pair);
      }
      for (const ids of (w?.value.templates || []) as string[][]) {
        const row = el(d, 'details');
        row.appendChild(el(d, 'summary', 'mono', `POSSIBLE TEMPLATE REUSE: ${ids.length} posts`));
        for (const id of ids) {
          const p = s.posts.find((p) => p.id === id);
          if (p) row.appendChild(postCard(ctx, p));
        }
        details.appendChild(row);
      }
    }
    if (section.title.startsWith('05')) details.appendChild(clusterView(ctx, s));
    if (section.title.startsWith('06')) details.appendChild(graphView(ctx, s));
    const refs = el(d, 'div', 'refs');
    for (const [role, ids] of Object.entries(s.displayRoles || {}))
      for (const id of ids)
        if (section.evidenceIds.includes(id))
          refs.appendChild(button(ctx, role, { type: 'show-evidence', id }, 'chip mono'));
    details.appendChild(refs);
    root.appendChild(details);
  }
  for (const c of s.coverage || [])
    root.appendChild(
      el(
        d,
        'p',
        'meta',
        `${c.provider}: ${c.status}; ${c.recordsExamined} records; ${c.query}. ${c.limitations.join(' ')} Coverage is bounded.`,
      ),
    );
  if (s.telemetry)
    root.appendChild(
      el(
        d,
        'p',
        'meta',
        `Requests ${s.telemetry.requests}; cache hits ${s.telemetry.cacheHits}; failures ${s.telemetry.failures}; tokens ${s.telemetry.tokens ?? 'unavailable'}; cost ${s.telemetry.cost ?? 'unavailable'}; ${s.telemetry.status}.`,
      ),
    );
  root.appendChild(
    el(
      d,
      'p',
      'meta',
      `Snapshot v${s.version}. ${s.correction?.reason || ''} Previous version: ${s.correction?.previousVersion ?? 'none'}.`,
    ),
  );
  const rc = el(d, 'section', 'card');
  rc.appendChild(el(d, 'div', 'card-title', 'Receipts'));
  rc.appendChild(
    el(
      d,
      'p',
      'caveat',
      'Versioned local receipts include source URLs, dates, coverage and correction history. No auto-posting or public hosting.',
    ),
  );
  const ra = el(d, 'div', 'actions');
  ra.append(
    button(ctx, 'PNG card', { type: 'export-png' }),
    button(ctx, 'JSON', { type: 'export-json' }),
    button(ctx, 'X thread draft', { type: 'thread' }),
  );
  rc.appendChild(ra);
  root.appendChild(rc);
  return root;
}

function origin(ctx: RenderCtx, s: Snapshot): HTMLElement {
  const d = ctx.doc;
  const root = el(d, 'div', 'pane');
  const ev = evidenceMap(ctx.inv);
  root.appendChild(el(d, 'h2', 'sec mono', 'ORIGIN X-RAY'));
  for (const f of s.findings.filter((f) => f.capability === 'origin'))
    root.appendChild(findingCard(ctx, f, ev));
  root.appendChild(el(d, 'h2', 'sec mono', 'VPN DETECTIVE'));
  const vpn = s.findings.filter((f) => f.capability === 'vpn');
  const conflicts = vpn.filter((f) => f.status === 'conflict');
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
  const d = ctx.doc;
  const c = el(d, 'section', 'card post');
  const h = el(d, 'div', 'card-head');
  h.append(
    el(d, 'span', 'mono', '@' + p.handle),
    el(
      d,
      'span',
      'mono meta',
      p.createdAt ? new Date(p.createdAt).toLocaleString() : 'time unknown',
    ),
  );
  c.appendChild(h);
  c.appendChild(el(d, 'p', 'post-text', p.text || '(no text captured)'));
  const m = el(d, 'div', 'meta');
  m.appendChild(link(d, p.url, 'open post'));
  if (p.lang) m.appendChild(el(d, 'span', 'mono', ' \u00b7 lang ' + p.lang));
  m.appendChild(
    el(d, 'span', 'mono', ' \u00b7 ' + (SOURCE_LABEL[p.capturedFrom] || p.capturedFrom)),
  );
  c.appendChild(m);
  if (p.authorCreatedAt)
    c.appendChild(
      el(d, 'p', 'meta', 'Account created: ' + p.authorCreatedAt + ' (authorized source)'),
    );
  if (p.links.length) {
    const ul = el(d, 'ul', 'links');
    for (const l of p.links) {
      const li = el(d, 'li');
      li.appendChild(link(d, l, l));
      ul.appendChild(li);
    }
    c.appendChild(ul);
  }
  for (const x of extra || []) c.appendChild(x);
  return c;
}

function orderedPosts(s: Snapshot): Post[] {
  const own = s.posts.filter((p) => p.handle.toLowerCase() === s.account.handle.toLowerCase());
  const focus = s.focusPostId ? own.find((p) => p.id === s.focusPostId) : undefined;
  const rest = own
    .filter((p) => p !== focus)
    .sort(
      (a, b) =>
        (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0),
    );
  return focus ? [focus, ...rest] : rest;
}

function narrative(ctx: RenderCtx, s: Snapshot): HTMLElement {
  const d = ctx.doc;
  const root = el(d, 'div', 'pane');
  root.appendChild(el(d, 'h2', 'sec mono', 'NARRATIVE'));
  root.appendChild(
    el(
      d,
      'p',
      'caveat',
      'Observed coverage only. Textual similarity and shared references do not establish common control.',
    ),
  );
  const edges = s.edges;
  root.append(clusterView(ctx, s), graphView(ctx, s));
  const posts = orderedPosts(s);
  if (!posts.length)
    root.appendChild(
      el(
        d,
        'p',
        'na',
        'No posts by this account were observed. Open its profile or a post and click Refresh.',
      ),
    );
  root.appendChild(el(d, 'div', 'meta mono', 'TIMELINE (' + posts.length + ' observed posts)'));
  for (const p of posts.slice(0, 25)) {
    const acts = el(d, 'div', 'actions');

    const gb = grokBotLink(ctx);
    if (gb) acts.appendChild(gb);
    root.appendChild(postCard(ctx, p, [acts]));
  }
  return root;
}

function claims(ctx: RenderCtx, s: Snapshot): HTMLElement {
  const d = ctx.doc;
  const root = el(d, 'div', 'pane');
  root.appendChild(el(d, 'h2', 'sec mono', 'CLAIMS'));
  root.appendChild(
    el(
      d,
      'p',
      'caveat',
      'Claims are split from selected post sentences. Verdicts require dated, scoped source passages. Ambiguous wording stays unverified.',
    ),
  );
  const byId = new Map(s.posts.map((p) => [p.id, p]));
  if (!s.claims.length)
    root.appendChild(
      el(d, 'p', 'na', 'No claim candidates observed (no posts with text by this account).'),
    );
  const ordered = [...s.claims].sort((a, b) =>
    a.postId === s.focusPostId ? -1 : b.postId === s.focusPostId ? 1 : 0,
  );
  for (const c of ordered) {
    const p = byId.get(c.postId);
    if (!p) continue;
    const acts = el(d, 'div', 'actions');
    acts.append(
      el(d, 'span', 'tag mono amber', c.status),
      el(d, 'p', 'statement', c.text),
      el(d, 'p', 'caveat', c.explanation || ''),
    );
    for (const id of c.evidenceIds)
      acts.appendChild(button(ctx, id, { type: 'show-evidence', id }, 'chip mono'));
    const gb = grokBotLink(ctx);
    if (gb) acts.appendChild(gb);
    root.appendChild(postCard(ctx, p, [acts]));
  }
  for (const f of s.findings.filter((f) => f.capability === 'claims'))
    root.appendChild(findingCard(ctx, f, evidenceMap(ctx.inv)));
  const seen = new Set<string>();
  for (const e of ctx.inv.evidence.filter(
    (e) => s.evidenceIds.includes(e.id) && e.kind === 'media',
  )) {
    const m = e.value.media as MediaObservation,
      key = m.sha256 || e.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const card = el(d, 'section', 'card media-details');
    card.append(
      el(d, 'h3', 'mono', 'MEDIA SOURCES'),
      button(ctx, e.id, { type: 'show-evidence', id: e.id }, 'chip mono'),
      link(d, m.url, 'User-associated source URL'),
    );
    if (m.verification) {
      const v = m.verification,
        detail = el(d, 'details');
      detail.append(
        el(d, 'summary', 'mono', 'Signature verification details'),
        el(d, 'p', 'meta', v.codes.join(' · ')),
        el(d, 'p', 'caveat', v.limitations.join(' ')),
      );
      card.append(detail);
    }
    for (const i of m.instances || []) {
      const line = el(d, 'p', 'meta');
      line.append(
        link(d, i.sourceUrl, i.title),
        el(
          d,
          'span',
          'mono',
          ' / ' + i.match + ' / ' + i.dateBasis + ' / ' + (i.publishedAt || 'date unavailable'),
        ),
      );
      card.append(line);
    }
    if (Object.keys(m.metadata).length) {
      const detail = el(d, 'details');
      detail.append(
        el(d, 'summary', 'mono', 'Embedded metadata (not verified event facts)'),
        el(d, 'pre', 'raw', JSON.stringify(m.metadata, null, 2)),
      );
      card.append(detail);
    }
    root.append(card);
  }
  return root;
}

function evidenceTab(ctx: RenderCtx, s: Snapshot, all: boolean): HTMLElement {
  const d = ctx.doc;
  const root = el(d, 'div', 'pane');
  const inSnap = new Set(s.evidenceIds);
  const list = ctx.inv.evidence
    .filter((e) => all || inSnap.has(e.id))
    .sort((a, b) => a.kind.localeCompare(b.kind) || b.lastSeenAt.localeCompare(a.lastSeenAt));
  const h = el(d, 'div', 'card-head');
  h.append(
    el(
      d,
      'h2',
      'sec mono',
      'EVIDENCE (' + list.length + (all ? ', full history' : ', this version') + ')',
    ),
    button(
      ctx,
      all ? 'This version' : 'Full history',
      { type: 'evidence-scope', all: !all },
      'btn small',
    ),
  );
  root.appendChild(h);
  for (const e of list) {
    const c = el(d, 'section', 'card evidence');
    c.id = 'evidence-' + e.id;
    c.dataset.evidenceId = e.id;
    const hh = el(d, 'div', 'card-head');
    hh.append(
      el(d, 'span', 'mono', e.id),
      el(d, 'span', 'tag mono' + (e.source === 'derived' ? ' amber' : ''), e.kind),
    );
    c.appendChild(hh);
    c.appendChild(el(d, 'p', 'statement', e.summary));
    c.appendChild(
      el(
        d,
        'div',
        'meta mono',
        'source: ' +
          (e.provider || SOURCE_LABEL[e.source] || e.source) +
          ' / ' +
          (e.provenance || 'legacy provenance; re-observe'),
      ),
    );
    c.appendChild(
      el(
        d,
        'div',
        'meta mono',
        'observed ' +
          new Date(e.observedAt).toLocaleString() +
          ' \u00b7 first ' +
          new Date(e.firstSeenAt).toLocaleDateString() +
          ' \u00b7 last ' +
          new Date(e.lastSeenAt).toLocaleDateString(),
      ),
    );
    if (e.derivedFrom && e.derivedFrom.length)
      c.appendChild(el(d, 'div', 'meta mono', 'derived from ' + e.derivedFrom.length + ' items'));
    if (e.url) {
      const m = el(d, 'div', 'meta');
      m.appendChild(link(d, e.url, e.url));
      c.appendChild(m);
    }
    const raw = el(d, 'details');
    raw.append(
      el(d, 'summary', 'mono', 'Stored observation'),
      el(d, 'pre', 'meta', JSON.stringify(e.value, null, 2)),
    );
    c.appendChild(raw);
    root.appendChild(c);
  }
  return root;
}

export function renderTab(
  ctx: RenderCtx,
  tabName: Tab,
  opts: { evidenceAll?: boolean } = {},
): HTMLElement {
  const s = currentSnapshot(ctx.inv, ctx.version);
  switch (tabName) {
    case 'Overview':
      return overview(ctx, s);
    case 'Origin':
      return origin(ctx, s);
    case 'Narrative':
      return narrative(ctx, s);
    case 'Claims':
      return claims(ctx, s);
    case 'Evidence':
      return evidenceTab(ctx, s, !!opts.evidenceAll);
  }
}

function clusterView(ctx: RenderCtx, s: Snapshot): HTMLElement {
  const d = ctx.doc,
    root = el(d, 'div'),
    ev = ctx.inv.evidence.find(
      (e) => s.evidenceIds.includes(e.id) && e.kind === 'narrative_distribution',
    );
  if (!ev) return root;
  const v = ev.value as any;
  root.appendChild(el(d, 'p', 'meta', v.method));
  for (const group of [
    ...v.clusters.map((x: any) => ({ ...x, label: 'Cluster: ' + x.label })),
    ...v.regions.map((x: any) => ({ ...x, label: 'Topic: ' + x.topic })),
    ...v.phrases.map((x: any) => ({ ...x, label: 'Repeated phrase: ' + x.phrase })),
  ]) {
    const details = el(d, 'details', 'card');
    details.appendChild(
      el(d, 'summary', 'mono', `${group.label} (${group.postIds.length} / ${v.total})`),
    );
    for (const id of group.postIds) {
      const p = s.posts.find((p) => p.id === id);
      if (p) details.appendChild(postCard(ctx, p));
    }
    root.appendChild(details);
  }
  return root;
}
function graphView(ctx: RenderCtx, s: Snapshot): HTMLElement {
  const d = ctx.doc,
    root = el(d, 'section', 'card'),
    ns = 'http://www.w3.org/2000/svg';
  root.appendChild(el(d, 'h3', 'mono', 'OBSERVED RELATIONSHIPS'));
  if (!s.edges.length) {
    root.appendChild(el(d, 'p', 'na', 'No supported relationships in this snapshot.'));
    return root;
  }
  const edges = s.edges.slice(0, 100),
    nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))].slice(0, 32);
  const svg = d.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 600 430');
  svg.setAttribute('aria-label', 'Interactive evidence graph');
  svg.classList.add('graph');
  const detail = el(d, 'div', 'graph-detail');
  const positions = new Map(
    nodes.map((n, i) => [
      n,
      {
        x: 300 + 240 * Math.cos((2 * Math.PI * i) / nodes.length),
        y: 210 + 170 * Math.sin((2 * Math.PI * i) / nodes.length),
      },
    ]),
  );
  const show = (edge: Snapshot['edges'][number]) => {
    detail.textContent = '';
    detail.appendChild(el(d, 'p', 'mono', edge.from + ' → ' + edge.type + ' → ' + edge.to));
    for (const id of edge.evidenceIds) {
      const e = ctx.inv.evidence.find((e) => e.id === id);
      if (e) {
        detail.append(
          button(ctx, id, { type: 'show-evidence', id }, 'chip mono'),
          el(d, 'p', 'statement', e.summary),
        );
        if (e.url) detail.appendChild(link(d, e.url, e.url));
      }
    }
  };
  for (const e of edges) {
    const a = positions.get(e.from),
      b = positions.get(e.to);
    if (!a || !b) continue;
    const line = d.createElementNS(ns, 'line');
    for (const [k, v] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }))
      line.setAttribute(k, String(v));
    line.setAttribute('stroke', '#7888b8');
    line.setAttribute('stroke-width', '5');
    line.style.pointerEvents = 'stroke';
    line.setAttribute('tabindex', '0');
    line.setAttribute('role', 'button');
    line.setAttribute('aria-label', e.type + ' ' + e.from + ' to ' + e.to);
    line.style.cursor = 'pointer';
    line.addEventListener('click', () => show(e));
    line.addEventListener('keydown', (e2) => {
      if (['Enter', ' '].includes((e2 as KeyboardEvent).key)) {
        e2.preventDefault();
        show(e);
      }
    });
    svg.appendChild(line);
  }
  for (const n of nodes) {
    const p = positions.get(n)!,
      circle = d.createElementNS(ns, 'circle');
    circle.setAttribute('cx', String(p.x));
    circle.setAttribute('cy', String(p.y));
    circle.setAttribute('r', '7');
    circle.setAttribute(
      'fill',
      n.startsWith('account:') ? '#70d6ff' : n.startsWith('claim:') ? '#ef8640' : '#ffe500',
    );
    svg.appendChild(circle);
    const text = d.createElementNS(ns, 'text');
    text.setAttribute('x', String(p.x));
    text.setAttribute('y', String(p.y - 12));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#e9e9ef');
    text.setAttribute('font-size', '9');
    text.textContent = n.length > 25 ? n.slice(0, 22) + '…' : n;
    const title = d.createElementNS(ns, 'title');
    title.textContent = n;
    text.appendChild(title);
    svg.appendChild(text);
  }
  root.append(
    svg,
    detail,
    el(
      d,
      'p',
      'meta',
      `Graph shows ${nodes.length} nodes and up to 100 edges. Complete relationship list: ${s.edges.length}. Every edge is derived from cited observations.`,
    ),
  );
  const list = el(d, 'details');
  list.appendChild(el(d, 'summary', 'mono', 'Inspect all relationships'));
  for (const e of s.edges)
    list.appendChild(
      button(
        ctx,
        e.type + ' / ' + e.from + ' → ' + e.to,
        { type: 'show-relationship', edgeId: e.id },
        'chip mono',
      ),
    );
  list.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const i = [...list.querySelectorAll('button')].indexOf(target as HTMLButtonElement);
    if (i >= 0) show(s.edges[i]);
  });
  root.appendChild(list);
  return root;
}
