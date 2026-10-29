/* Compact account provenance popover shown when a badge is clicked. Built with textContent only. */
import type { AboutInfo } from './lib.ts';

export interface PopoverOpts {
  handle: string; info: (AboutInfo & { t?: number }) | null; statedLocation: string;
  evaluation: { known: boolean; name: string | null; isRegion: boolean; warnings: string[]; flag: string };
  askGrok: boolean; onInvestigate: () => void; onAskGrok: () => void;
}

let cleanup: (() => void) | null = null;

export function closePopover(doc: Document) {
  if (cleanup) { const c = cleanup; cleanup = null; c(); }
  for (const el of doc.querySelectorAll('.cf-pop')) el.remove();
}

function row(doc: Document, label: string, value: string | null, note?: string): HTMLElement {
  const r = doc.createElement('div'); r.className = 'cf-pop-row';
  const l = doc.createElement('span'); l.className = 'cf-pop-label'; l.textContent = label;
  const v = doc.createElement('span'); v.className = 'cf-pop-value' + (value ? '' : ' cf-pop-na'); v.textContent = value || 'Unavailable';
  r.append(l, v);
  if (note) { const n = doc.createElement('div'); n.className = 'cf-pop-note'; n.textContent = note; r.appendChild(n); }
  return r;
}

export function openPopover(doc: Document, anchor: HTMLElement, o: PopoverOpts): HTMLElement {
  closePopover(doc);
  const pop = doc.createElement('div');
  pop.className = 'cf-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Chud Finder: @' + o.handle);
  const head = doc.createElement('div'); head.className = 'cf-pop-head';
  const title = doc.createElement('span'); title.className = 'cf-pop-title'; title.textContent = '@' + o.handle;
  const x = doc.createElement('button'); x.className = 'cf-pop-x'; x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '\u00d7';
  head.append(title, x);
  pop.appendChild(head);

  const i = o.info;
  const when = i && i.t ? new Date(i.t).toLocaleString() : null;
  const srcNote = when ? 'X \u201cAbout this account\u201d, seen in your session ' + when : 'X \u201cAbout this account\u201d';
  if (i && i.pending) pop.appendChild(row(doc, 'Based in', null, 'Still looking up\u2026'));
  else if (i && i.error) pop.appendChild(row(doc, 'Based in', null, 'Lookup failed: ' + i.error));
  else {
    pop.appendChild(row(doc, 'Based in', o.evaluation.known ? (o.evaluation.flag + ' ' + o.evaluation.name + (o.evaluation.isRegion ? ' (region)' : '')) : null, srcNote));
    pop.appendChild(row(doc, 'Connected via', i && i.source ? i.source : null));
    pop.appendChild(row(doc, 'Location note', i && i.accurate === false ? 'X says it may not be accurate (possible VPN/proxy)' : i && i.accurate === true ? 'None' : null));
  }
  pop.appendChild(row(doc, 'Profile location', o.statedLocation || null, o.statedLocation ? 'Self-reported by the account' : undefined));
  if (o.evaluation.warnings.length) {
    const w = doc.createElement('ul'); w.className = 'cf-pop-warn';
    for (const t of o.evaluation.warnings) { const li = doc.createElement('li'); li.textContent = t; w.appendChild(li); }
    pop.appendChild(w);
  }
  const foot = doc.createElement('div'); foot.className = 'cf-pop-actions';
  const inv = doc.createElement('button'); inv.type = 'button'; inv.className = 'cf-pop-btn cf-pop-primary'; inv.textContent = 'Investigate';
  inv.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); o.onInvestigate(); });
  foot.appendChild(inv);
  if (o.askGrok) {
    const g = doc.createElement('button'); g.type = 'button'; g.className = 'cf-pop-btn'; g.textContent = 'Ask Grok';
    g.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); o.onAskGrok(); });
    foot.appendChild(g);
  }
  pop.appendChild(foot);
  const fine = doc.createElement('div'); fine.className = 'cf-pop-fine';
  fine.textContent = 'A location is context, not proof a post is true or false.';
  pop.appendChild(fine);

  // Keep X from reacting to clicks inside the popover.
  for (const t of ['click', 'mousedown', 'pointerdown', 'auxclick']) pop.addEventListener(t, e => e.stopPropagation());
  x.addEventListener('click', e => { e.preventDefault(); closePopover(doc); anchor.focus && anchor.focus(); });

  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  const win = doc.defaultView as any;
  if (r && win) {
    pop.style.top = Math.max(8, Math.min(r.bottom + 6, (win.innerHeight || 800) - 280)) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, (win.innerWidth || 1200) - 320)) + 'px';
  }
  (doc.body || doc.documentElement).appendChild(pop);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { closePopover(doc); anchor.focus && anchor.focus(); } };
  const onDown = (e: Event) => { if (!pop.contains(e.target as Node) && e.target !== anchor) closePopover(doc); };
  const onScroll = () => closePopover(doc);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('mousedown', onDown, true);
  win && win.addEventListener('scroll', onScroll, { passive: true });
  cleanup = () => { doc.removeEventListener('keydown', onKey, true); doc.removeEventListener('mousedown', onDown, true); win && win.removeEventListener('scroll', onScroll); };
  inv.focus && inv.focus();
  return pop;
}
