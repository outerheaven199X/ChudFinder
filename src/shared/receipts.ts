/* Receipts: shareable artifacts built only from the local evidence snapshot. */
import { currentSnapshot } from './engine.ts';
import { cleanText } from './sanitize.ts';
import { Export } from './schemas.ts';
import type { Evidence, Finding, Investigation } from './schemas.ts';

export const LIMITATIONS = [
  'Built from user-selected or supplied observations and explicitly configured authorized providers. Coverage is bounded.',
  'About this account displays are USER-CAPTURED unless an authorized platform source is explicitly recorded.',
  'Posting hours, wording similarity and location do not establish physical whereabouts, common control or factual truth.',
  'No public permalink: receipts are local files (JSON / PNG) or a text draft.'
];

export function buildExport(inv: Investigation, version?: number, now = new Date().toISOString()): Export {
  const s = currentSnapshot(inv, version);
  const cited = new Set(s.evidenceIds);
  return Export.parse({
    exportVersion: 1, generatedAt: now, generator: 'Chud Finder ' + s.engine, investigationId: inv.id, version: s.version,
    subject: inv.subject, account: s.account, headline: s.headline, findings: s.findings,
    evidence: inv.evidence.filter(e => cited.has(e.id)), limitations: [...LIMITATIONS,...(s.coverage||[]).flatMap(c=>c.limitations)],
    snapshot:s, correction:s.correction, previousVersions:inv.snapshots.filter(v=>v.version<s.version).map(v=>v.version)
  });
}

const PRIORITY = ['Location comparison', 'Account based in', 'X location-accuracy note', 'Conflict: connection region',
  'Conflict: self-described location', 'Corroborated country', 'Posting-hour pattern', 'Connected via', 'Profile location', 'Post languages'];
/** Most important findings first (for receipts, which have limited room). */
export function rankFindings(fs: Finding[]): Finding[] {
  const r = (f: Finding) => { const i = PRIORITY.indexOf(f.title); return i < 0 ? PRIORITY.length : i; };
  return [...fs].sort((a, b) => r(a) - r(b));
}

function shortRef(e: Evidence): string { return e.url ? e.url : e.source; }

/** A copyable X thread draft (each part <= 280 chars). Never auto-posted. */
export function threadDraft(inv: Investigation, version?: number): string[] {
  const s = currentSnapshot(inv, version);
  const ev = new Map(inv.evidence.map(e => [e.id, e]));
  const parts: string[] = [];
  parts.push(cleanText('Provenance check on @' + inv.subject.handle + ' (Chud Finder, ' + s.createdAt.slice(0, 10) + '): ' + s.headline, 270));
  const fs = rankFindings(s.findings).slice(0, 6);
  for (const f of fs) {
    const refs = f.evidenceIds.map(id => ev.get(id)).filter((e): e is Evidence => !!e).map(shortRef);
    const src = refs.length ? ' Source: ' + [...new Set(refs)][0] : '';
    parts.push(cleanText('[' + f.basis + '] ' + f.title + ': ' + f.statement, 270 - src.length) + src);
  }
  parts.push('Receipt '+inv.id+' / v'+s.version+' / '+s.createdAt+'. Previous: '+(s.correction?.previousVersion??'none')+'. '+cleanText(s.correction?.reason||'No correction note.',90));
  parts.push('Method: authorized providers and labeled user observations. Bounded coverage; location and shared wording do not prove truth or common control. Full sources, dates and strength criteria are in the matching JSON receipt.');
  return parts.map((p, i) => (i + 1) + '/' + parts.length + ' ' + p).map(p => p.slice(0, 280));
}
