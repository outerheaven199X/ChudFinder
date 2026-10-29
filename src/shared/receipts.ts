/* Receipts: shareable artifacts built only from the local evidence snapshot. */
import { currentSnapshot } from './engine.ts';
import { cleanText } from './sanitize.ts';
import { Export } from './schemas.ts';
import type { Evidence, Finding, Investigation } from './schemas.ts';

export const LIMITATIONS = [
  'Built from what this browser observed in the user\u2019s own X session; nothing was fetched by a server.',
  'X\u2019s About this account values are reported by X and can be wrong.',
  'Inferred findings are estimates at country level only. A location says nothing about whether posts are true.',
  'No public permalink: receipts are local files (JSON / PNG) or a text draft.'
];

export function buildExport(inv: Investigation, version?: number, now = new Date().toISOString()): Export {
  const s = currentSnapshot(inv, version);
  const cited = new Set(s.findings.flatMap(f => f.evidenceIds));
  return Export.parse({
    exportVersion: 1, generatedAt: now, generator: 'Chud Finder ' + s.engine, investigationId: inv.id, version: s.version,
    subject: inv.subject, account: s.account, headline: s.headline, findings: s.findings,
    evidence: inv.evidence.filter(e => cited.has(e.id)), limitations: LIMITATIONS
  });
}

const PRIORITY = ['Likely operating region', 'Account based in', 'X location-accuracy note', 'Conflict: connection region',
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
  parts.push('Method: X\u2019s own About this account data seen in my session plus on-page observations. Country level only; location is context, not proof a post is true or false.');
  return parts.map((p, i) => (i + 1) + '/' + parts.length + ' ' + p).map(p => p.slice(0, 280));
}
