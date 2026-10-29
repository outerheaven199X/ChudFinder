/* Chud Finder - deterministic investigation engine (no model, no network).
 * Observations from the user's own X session -> stored evidence -> Origin X-Ray + VPN Detective
 * findings, claim candidates and relationship edges. Every finding cites stored evidence ids.
 * Hard boundaries: country level only; no nationality inference; location is never treated as a
 * signal of whether posts are true.
 */
import * as C from './countries.ts';
import { hashId } from './hash.ts';
import { activityPattern, classifySource, countryFromStatedLocation, countryName, fmtOffset, offsetConsistent } from './geo.ts';
import { cleanText, violatesBoundaries } from './sanitize.ts';
import {
  Account, AccountObservation, Claim, ENGINE_VERSION, Evidence, Finding, Investigation, InvestigationEvent,
  Post, RelationshipEdge, SCHEMA_VERSION, Snapshot
} from './schemas.ts';
import type { Basis, Capability } from './schemas.ts';

export const MAX_EVENTS = 200;
export const MAX_SNAPSHOTS = 20;
export const MAX_EVIDENCE = 600;

export function investigationId(handle: string): string {
  return hashId('inv', 'account', handle.toLowerCase());
}

// ---------------------------------------------------------------- evidence
type NewEvidence = Omit<Evidence, 'id' | 'firstSeenAt' | 'lastSeenAt'>;

function mkEvidence(e: NewEvidence): Evidence {
  // Stable id: same source + kind + subject + value => same evidence (re-observations just bump lastSeenAt).
  const id = hashId('ev', e.source, e.kind, e.subject.toLowerCase(), e.value);
  return Evidence.parse({ ...e, id, firstSeenAt: e.observedAt, lastSeenAt: e.observedAt });
}

/** Turn one validated observation into evidence records (not yet merged). */
export function evidenceFromObservation(obsIn: AccountObservation): Evidence[] {
  const obs = AccountObservation.parse(obsIn);
  const h = obs.handle;
  const out: Evidence[] = [];
  const profileUrl = 'https://x.com/' + h + '/about';
  if (obs.about) {
    const a = obs.about;
    if (a.notFound || (!a.basedIn && a.accurate === null && !a.source)) {
      out.push(mkEvidence({ kind: 'about_unavailable', source: 'x_about_account', subject: h, url: profileUrl,
        summary: 'X\u2019s About this account showed no based-in, accuracy or connection data.', value: { notFound: a.notFound }, observedAt: a.observedAt }));
    }
    if (a.basedIn) {
      const c = C.findCountry(a.basedIn);
      out.push(mkEvidence({ kind: 'about_based_in', source: 'x_about_account', subject: h, url: profileUrl,
        summary: 'Account based in: ' + cleanText(a.basedIn, 80) + (c ? '' : ' (region)'),
        value: { basedIn: cleanText(a.basedIn, 80), country: c ? c.code : null, isRegion: !c }, observedAt: a.observedAt }));
    }
    if (a.accurate !== null) {
      out.push(mkEvidence({ kind: 'about_location_accuracy', source: 'x_about_account', subject: h, url: profileUrl,
        summary: a.accurate ? 'X shows no location-accuracy note.' : 'X notes the location may not be accurate (possible VPN or proxy).',
        value: { accurate: a.accurate }, observedAt: a.observedAt }));
    }
    if (a.source) {
      const s = classifySource(a.source);
      const c = s.country ? C.findCountry(s.country) : null;
      out.push(mkEvidence({ kind: 'about_connected_via', source: 'x_about_account', subject: h, url: profileUrl,
        summary: 'Connected via: ' + cleanText(a.source, 80),
        value: { raw: cleanText(a.source, 80), platform: s.platform, country: c ? c.code : null }, observedAt: a.observedAt }));
    }
  }
  if (obs.profileLocation && cleanText(obs.profileLocation.text, 120)) {
    const text = cleanText(obs.profileLocation.text, 120);
    out.push(mkEvidence({ kind: 'profile_location', source: 'x_profile', subject: h, url: 'https://x.com/' + h,
      summary: 'Self-described profile location: \u201c' + text + '\u201d', value: { text, country: countryFromStatedLocation(text) },
      observedAt: obs.profileLocation.observedAt }));
  }
  const seenPosts = new Set<string>();
  for (const p of obs.posts) {
    if (seenPosts.has(p.id)) continue;
    seenPosts.add(p.id);
    const post = Post.parse({ ...p, text: cleanText(p.text, 4000) });
    out.push(mkEvidence({ kind: 'post', source: post.capturedFrom, subject: post.handle, url: post.url,
      summary: (post.handle.toLowerCase() === h.toLowerCase() ? '' : '@' + post.handle + ': ') + (cleanText(post.text, 160) || '(no text)'),
      value: { post }, observedAt: obs.observedAt }));
  }
  const own = obs.posts.filter(p => p.handle.toLowerCase() === h.toLowerCase());
  const times = own.map(p => p.createdAt).filter((t): t is string => !!t);
  if (times.length) {
    const ap = activityPattern(times);
    const ids = out.filter(e => e.kind === 'post' && e.subject.toLowerCase() === h.toLowerCase()).map(e => e.id);
    out.push(mkEvidence({ kind: 'activity_pattern', source: 'derived', subject: h,
      summary: ap.usable ? 'Posting hours suggest roughly ' + fmtOffset(ap.estOffsetHours!) + ' (\u00b13h), from ' + ap.posts + ' posts.' : 'Posting-hour pattern not usable: ' + ap.reason,
      value: { ...ap }, observedAt: obs.observedAt, derivedFrom: ids }));
    const langs: Record<string, number> = {};
    for (const p of own) if (p.lang && p.lang !== 'und' && p.lang !== 'zxx') langs[p.lang] = (langs[p.lang] || 0) + 1;
    if (Object.keys(langs).length) {
      out.push(mkEvidence({ kind: 'post_languages', source: 'derived', subject: h,
        summary: 'Post languages tagged by X: ' + Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([l, n]) => l + ' \u00d7' + n).join(', '),
        value: { languages: langs }, observedAt: obs.observedAt, derivedFrom: ids }));
    }
  }
  return out;
}

/** Merge new evidence into the stored history: append new ids, bump lastSeenAt on re-observation. */
export function mergeEvidence(existing: Evidence[], incoming: Evidence[]): Evidence[] {
  const byId = new Map(existing.map(e => [e.id, { ...e }]));
  for (const e of incoming) {
    const prev = byId.get(e.id);
    if (prev) {
      if (e.lastSeenAt > prev.lastSeenAt) prev.lastSeenAt = e.lastSeenAt;
      if (e.observedAt > prev.observedAt) prev.observedAt = e.observedAt;
    } else byId.set(e.id, e);
  }
  let all = [...byId.values()];
  if (all.length > MAX_EVIDENCE) all = all.sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1)).slice(0, MAX_EVIDENCE);
  return all;
}

// ---------------------------------------------------------------- analysis
interface F { capability: Capability; title: string; statement: string; basis: Basis; status: Finding['status'];
  confidence: Finding['confidence']; country: string | null; evidenceIds: string[]; caveats?: string[] }

function finding(f: F): Finding {
  const evidenceIds = [...new Set(f.evidenceIds)].sort();
  return Finding.parse({ ...f, evidenceIds, caveats: f.caveats || [], id: hashId('fd', f.capability, f.title, f.statement, evidenceIds) });
}

const LOCATION_CAVEAT = 'A location is context about where an account operates, not evidence that its posts are true or false.';

export interface Analysis { account: Account; findings: Finding[]; claims: Claim[]; edges: RelationshipEdge[]; posts: Post[]; headline: string }

/** Analyze the evidence observed in the current snapshot. Pure and deterministic. */
export function analyze(handle: string, current: Evidence[]): Analysis {
  const h = handle.toLowerCase();
  const mine = current.filter(e => e.subject.toLowerCase() === h);
  const one = (k: Evidence['kind']) => mine.filter(e => e.kind === k).sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1))[0];
  const based = one('about_based_in'), acc = one('about_location_accuracy'), via = one('about_connected_via');
  const unavailable = one('about_unavailable'), prof = one('profile_location'), act = one('activity_pattern'), langs = one('post_languages');

  const basedCountry = (based?.value.country as string | null) ?? null;
  const viaCountry = (via?.value.country as string | null) ?? null;
  const profCountry = (prof?.value.country as string | null) ?? null;
  const vpnNote = acc ? acc.value.accurate === false : false;
  const ap = act?.value as unknown as ReturnType<typeof activityPattern> | undefined;

  const findings: Finding[] = [];
  const add = (f: F) => findings.push(finding(f));

  // ---- Origin X-Ray
  if (based) {
    add({ capability: 'origin', title: 'Account based in', basis: 'reported', status: 'info', confidence: 'high', country: basedCountry,
      statement: 'X\u2019s About this account reports this account is based in ' + based.value.basedIn + (based.value.isRegion ? ' (X shows a region, not a country).' : '.'),
      evidenceIds: [based.id], caveats: ['Read from X in your own signed-in session; X\u2019s value can itself be wrong.', LOCATION_CAVEAT] });
  } else {
    add({ capability: 'origin', title: 'Account based in', basis: 'unknown', status: 'undetermined', confidence: 'none', country: null,
      statement: unavailable ? 'X did not show an \u201cAccount based in\u201d value for this account.' : 'Not observed yet: X\u2019s About this account data was unavailable in this session.',
      evidenceIds: unavailable ? [unavailable.id] : [] });
  }
  if (via) {
    add({ capability: 'origin', title: 'Connected via', basis: 'reported', status: 'info', confidence: 'high', country: viaCountry,
      statement: 'X reports the account connects via ' + via.value.raw + '.', evidenceIds: [via.id],
      caveats: ['An app-store region reflects the store account\u2019s country, which can differ from where someone is.'] });
  }
  if (prof) {
    add({ capability: 'origin', title: 'Profile location', basis: 'self-described', status: 'info', confidence: profCountry ? 'medium' : 'low', country: profCountry,
      statement: 'The profile says \u201c' + prof.value.text + '\u201d' + (profCountry ? ', which maps to ' + countryName(profCountry) + '.' : '; it does not map to a country.'),
      evidenceIds: [prof.id], caveats: ['Self-described by the account owner; anyone can type anything here.'] });
  }

  // Corroboration / conflicts against X's based-in country.
  const conflicts: string[] = [];
  if (basedCountry) {
    const agree = [based!.id];
    if (viaCountry === basedCountry) agree.push(via!.id);
    if (profCountry === basedCountry) agree.push(prof!.id);
    if (agree.length > 1) {
      add({ capability: 'origin', title: 'Corroborated country', basis: 'corroborated', status: 'consistent', confidence: agree.length > 2 ? 'high' : 'medium', country: basedCountry,
        statement: (agree.length) + ' independent signals agree on ' + countryName(basedCountry) + ' (' +
          [viaCountry === basedCountry ? 'connection region' : null, profCountry === basedCountry ? 'self-described location' : null].filter(Boolean).join(', ') + ' match X\u2019s based-in value).',
        evidenceIds: agree });
    }
    if (viaCountry && viaCountry !== basedCountry) {
      conflicts.push('connection');
      add({ capability: 'vpn', title: 'Conflict: connection region', basis: 'reported', status: 'conflict', confidence: 'medium', country: null,
        statement: 'X says based in ' + countryName(basedCountry) + ' but connected via ' + via!.value.raw + '.', evidenceIds: [based!.id, via!.id],
        caveats: ['Common for travellers, expats and people using another country\u2019s app store.'] });
    }
    if (profCountry && profCountry !== basedCountry) {
      conflicts.push('profile');
      add({ capability: 'vpn', title: 'Conflict: self-described location', basis: 'self-described', status: 'conflict', confidence: 'low', country: null,
        statement: 'The profile names ' + countryName(profCountry) + ', but X says based in ' + countryName(basedCountry) + '.', evidenceIds: [based!.id, prof!.id] });
    }
  }

  // ---- VPN Detective
  if (acc) {
    add({ capability: 'vpn', title: 'X location-accuracy note', basis: 'reported', status: vpnNote ? 'conflict' : 'consistent', confidence: 'high', country: null,
      statement: vpnNote ? 'X notes this account\u2019s location may not be accurate (possible VPN or proxy).' : 'X shows no location-accuracy (VPN/proxy) note for this account.',
      evidenceIds: [acc.id] });
  } else {
    add({ capability: 'vpn', title: 'X location-accuracy note', basis: 'unknown', status: 'undetermined', confidence: 'none', country: null,
      statement: 'Unavailable: X did not provide a location-accuracy value in this session.', evidenceIds: unavailable ? [unavailable.id] : [] });
  }
  if (act) {
    if (ap && ap.usable && ap.estOffsetHours !== null) {
      const vs = basedCountry ? offsetConsistent(basedCountry, ap.estOffsetHours) : null;
      if (vs === false) conflicts.push('activity');
      add({ capability: 'vpn', title: 'Posting-hour pattern', basis: 'inferred', status: vs === false ? 'conflict' : vs === true ? 'consistent' : 'info', confidence: 'low', country: null,
        statement: 'From ' + ap.posts + ' observed posts, activity is quietest from ' + String(ap.quietStartUtc).padStart(2, '0') + ':00 UTC, which fits roughly ' + fmtOffset(ap.estOffsetHours) + ' (\u00b13h)' +
          (vs === true ? ', consistent with ' + countryName(basedCountry) + '.' : vs === false ? ', which does not fit ' + countryName(basedCountry) + '.' : '.'),
        evidenceIds: [act.id, ...(based && vs !== null ? [based.id] : [])],
        caveats: ['Weak signal: schedulers, shift work and shared accounts change posting hours.'] });
    } else {
      add({ capability: 'vpn', title: 'Posting-hour pattern', basis: 'unknown', status: 'undetermined', confidence: 'none', country: null,
        statement: 'Not enough timing data: ' + (ap ? ap.reason : 'no timestamps observed.'), evidenceIds: [act.id] });
    }
  }
  if (langs) {
    add({ capability: 'vpn', title: 'Post languages', basis: 'reported', status: 'info', confidence: 'low', country: null,
      statement: langs.summary + '. Language is shown for context only and is not used to infer a country.', evidenceIds: [langs.id, ...(langs.derivedFrom || [])] });
  }

  // Likely operating region (country level). Reported value stands unless X flags it or signals conflict.
  const region = likelyRegion({ based, via, prof, act, basedCountry, viaCountry, profCountry, vpnNote, ap, conflicts });
  add(region);

  // ---- Claims + Narrative (observable only, never auto-verified)
  const postEv = current.filter(e => e.kind === 'post');
  const posts: Post[] = postEv.map(e => e.value.post as Post);
  const claims: Claim[] = [];
  const edges: RelationshipEdge[] = [];
  for (const e of postEv) {
    const p = e.value.post as Post;
    if (p.handle.toLowerCase() === h && p.text.replace(/https?:\/\/\S+/g, '').trim().length >= 20 && claims.length < 10) {
      claims.push(Claim.parse({ id: hashId('cl', p.id), postId: p.id, text: cleanText(p.text, 1000), status: 'unverified', evidenceIds: [e.id] }));
    }
    const from = 'post:' + p.id;
    if (p.quotedPostId) edges.push(RelationshipEdge.parse({ id: hashId('ed', 'q', p.id, p.quotedPostId), type: 'quotes', from, to: 'post:' + p.quotedPostId + (p.quotedHandle ? '@' + p.quotedHandle : ''), evidenceIds: [e.id] }));
    if (p.replyToHandle) edges.push(RelationshipEdge.parse({ id: hashId('ed', 'r', p.id, p.replyToHandle), type: 'replies_to', from, to: 'account:' + p.replyToHandle, evidenceIds: [e.id] }));
    for (const l of p.links) edges.push(RelationshipEdge.parse({ id: hashId('ed', 'l', p.id, l), type: 'links_to', from, to: l, evidenceIds: [e.id] }));
  }

  const account = Account.parse({
    handle, basedIn: (based?.value.basedIn as string) ?? null, basedInCountry: basedCountry, basedInIsRegion: !!based?.value.isRegion,
    locationAccurate: acc ? (acc.value.accurate as boolean) : null, connectedVia: (via?.value.raw as string) ?? null,
    profileLocation: (prof?.value.text as string) ?? null, aboutObservedAt: (based || acc || via || unavailable)?.observedAt ?? null
  });
  const headline = cleanText([
    based ? 'X reports based in ' + based.value.basedIn + '.' : 'Based-in country unavailable.',
    vpnNote ? 'X notes a possible VPN/proxy.' : '',
    conflicts.length ? conflicts.length + ' conflicting signal' + (conflicts.length > 1 ? 's' : '') + '.' : '',
    'Likely operating region: ' + (region.country ? countryName(region.country) + ' (' + region.basis + ', ' + region.confidence + ')' : 'undetermined') + '.'
  ].filter(Boolean).join(' '), 200);
  return { account, findings, claims, edges: dedupeById(edges), posts, headline };
}

function dedupeById<T extends { id: string }>(xs: T[]): T[] { const m = new Map<string, T>(); for (const x of xs) m.set(x.id, x); return [...m.values()]; }

function likelyRegion(s: { based?: Evidence; via?: Evidence; prof?: Evidence; act?: Evidence; basedCountry: string | null; viaCountry: string | null;
  profCountry: string | null; vpnNote: boolean; ap?: ReturnType<typeof activityPattern>; conflicts: string[] }): Finding {
  const title = 'Likely operating region';
  if (s.basedCountry && !s.vpnNote && !s.conflicts.length) {
    return finding({ capability: 'vpn', title, basis: 'reported', status: 'consistent', confidence: 'high', country: s.basedCountry,
      statement: 'No conflicting signals: X\u2019s based-in value (' + countryName(s.basedCountry) + ') stands.', evidenceIds: [s.based!.id], caveats: [LOCATION_CAVEAT] });
  }
  const score = new Map<string, { n: number; ev: string[] }>();
  const bump = (c: string | null, w: number, id?: string) => {
    if (!c) return; const r = score.get(c) || { n: 0, ev: [] }; r.n += w; if (id) r.ev.push(id); score.set(c, r);
  };
  bump(s.basedCountry, s.vpnNote ? 1 : 3, s.based?.id);
  bump(s.viaCountry, 2, s.via?.id);
  bump(s.profCountry, 1, s.prof?.id);
  if (s.ap && s.ap.usable && s.ap.estOffsetHours !== null) {
    for (const [c, r] of score) {
      const ok = offsetConsistent(c, s.ap.estOffsetHours);
      if (ok === true) { r.n += 1; r.ev.push(s.act!.id); } else if (ok === false) { r.n -= 1; r.ev.push(s.act!.id); }
    }
  }
  const ranked = [...score.entries()].sort((a, b) => b[1].n - a[1].n);
  const allIds = [s.based, s.via, s.prof, s.act].filter((e): e is Evidence => !!e).map(e => e.id);
  if (ranked.length && ranked[0][1].n >= 3 && (ranked.length === 1 || ranked[0][1].n - ranked[1][1].n >= 2)) {
    const [c, r] = ranked[0];
    return finding({ capability: 'vpn', title, basis: 'inferred', status: 'consistent', confidence: r.n >= 5 ? 'medium' : 'low', country: c,
      statement: 'The available signals point most to ' + countryName(c) + ' (score ' + r.n + (ranked[1] ? ' vs ' + ranked[1][1].n + ' for ' + countryName(ranked[1][0]) : '') + '). This is an inference, not a fact.',
      evidenceIds: r.ev, caveats: ['Country level only.', LOCATION_CAVEAT] });
  }
  return finding({ capability: 'vpn', title, basis: 'unknown', status: 'undetermined', confidence: 'none', country: null,
    statement: 'Location undetermined: the observed signals do not support a single country' +
      (ranked.length ? ' (candidates: ' + ranked.map(([c, r]) => countryName(c) + ' ' + r.n).join(', ') + ').' : '.'),
    evidenceIds: allIds, caveats: ['Ask Grok or the Chud Finder Grok Bot can look at public posts for more clues; treat its answer as a guess.'] });
}

// ---------------------------------------------------------------- validation
export interface ValidationIssue { findingId: string; problem: string }

/** Citation + boundary validation. Every non-unknown finding must cite evidence that exists in the store. */
export function validateFindings(findings: unknown[], evidence: Evidence[]): { ok: boolean; valid: Finding[]; issues: ValidationIssue[] } {
  const ids = new Set(evidence.map(e => e.id));
  const valid: Finding[] = []; const issues: ValidationIssue[] = [];
  for (const raw of findings) {
    const p = Finding.safeParse(raw);
    const fid = (raw && typeof raw === 'object' && typeof (raw as any).id === 'string') ? (raw as any).id : '?';
    if (!p.success) { issues.push({ findingId: fid, problem: 'schema: ' + p.error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; ') }); continue; }
    const f = p.data;
    const missing = f.evidenceIds.filter(id => !ids.has(id));
    if (missing.length) { issues.push({ findingId: f.id, problem: 'cites evidence that does not exist: ' + missing.join(', ') }); continue; }
    if (f.basis !== 'unknown' && !f.evidenceIds.length) { issues.push({ findingId: f.id, problem: 'a ' + f.basis + ' finding must cite evidence' }); continue; }
    if (f.basis === 'reported' && !f.evidenceIds.some(id => evidence.find(e => e.id === id)?.source !== 'derived')) {
      issues.push({ findingId: f.id, problem: 'a reported finding must cite observed (non-derived) evidence' }); continue;
    }
    if (f.country && f.basis !== 'unknown') {
      const supports = f.evidenceIds.some(id => { const e = evidence.find(x => x.id === id)!; return e.value.country === f.country; });
      if (!supports) { issues.push({ findingId: f.id, problem: 'country ' + f.country + ' is not supported by any cited evidence' }); continue; }
    }
    const bad = violatesBoundaries(f.title + ' ' + f.statement + ' ' + f.caveats.join(' '));
    if (bad) { issues.push({ findingId: f.id, problem: 'crosses a hard boundary (' + bad + ')' }); continue; }
    valid.push(f);
  }
  return { ok: issues.length === 0, valid, issues };
}

// ---------------------------------------------------------------- investigations
function ev(at: string, type: InvestigationEvent['type'], version: number, detail: string): InvestigationEvent {
  return InvestigationEvent.parse({ at, type, version, detail: cleanText(detail, 300) });
}

/** Create or refresh (new version) an account investigation from one observation. */
export function upsertInvestigation(existing: Investigation | null, obsIn: AccountObservation, now = new Date().toISOString()): Investigation {
  const obs = AccountObservation.parse(obsIn);
  const id = investigationId(obs.handle);
  const prev = existing ? Investigation.parse(existing) : null;
  if (prev && prev.id !== id) throw new Error('investigation id mismatch');
  const version = prev ? prev.currentVersion + 1 : 1;
  const events: InvestigationEvent[] = prev ? [...prev.events] : [ev(now, 'created', 1, 'Investigation of @' + obs.handle + ' created')];
  if (prev) events.push(ev(now, 'refreshed', version, 'Refreshed from the current page'));
  events.push(ev(now, 'observed', version, 'Observed ' + (obs.about ? 'About this account data' : 'no About this account data') + ', ' + obs.posts.length + ' posts on ' + obs.pageUrl));

  const fresh = evidenceFromObservation(obs);
  const before = new Set((prev?.evidence || []).map(e => e.id));
  const evidence = mergeEvidence(prev?.evidence || [], fresh);
  const added = fresh.filter(e => !before.has(e.id)).length;
  events.push(ev(now, 'evidence_added', version, added + ' new evidence item' + (added === 1 ? '' : 's') + ', ' + (fresh.length - added) + ' re-observed'));

  // Analyze what is observed now, plus the latest About/profile evidence from history if this page lacked it.
  const current = [...fresh];
  for (const kind of ['about_based_in', 'about_location_accuracy', 'about_connected_via', 'profile_location'] as const) {
    if (!current.some(e => e.kind === kind) && !current.some(e => e.kind === 'about_unavailable' && kind.startsWith('about'))) {
      const latest = evidence.filter(e => e.kind === kind).sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))[0];
      if (latest) current.push(latest);
    }
  }
  const a = analyze(obs.handle, current);
  const check = validateFindings(a.findings, evidence);
  if (!check.ok) events.push(ev(now, 'validation_failed', version, check.issues.map(i => i.problem).join('; ')));
  events.push(ev(now, 'analyzed', version, check.valid.length + ' findings (' + ENGINE_VERSION + ')'));

  const snap = Snapshot.parse({
    version, createdAt: now, engine: ENGINE_VERSION, adapterVersion: obs.adapterVersion, account: a.account,
    evidenceIds: current.map(e => e.id), findings: check.valid, claims: a.claims, edges: a.edges, posts: a.posts,
    focusPostId: obs.focusPostId, headline: a.headline
  });
  const snapshots = [...(prev?.snapshots || []), snap].slice(-MAX_SNAPSHOTS);
  return Investigation.parse({
    schemaVersion: SCHEMA_VERSION, id, subject: { type: 'account', handle: obs.handle },
    createdAt: prev?.createdAt || now, updatedAt: now, currentVersion: version, evidence, snapshots, events: events.slice(-MAX_EVENTS)
  });
}

export function currentSnapshot(inv: Investigation, version?: number): Snapshot {
  return inv.snapshots.find(s => s.version === (version ?? inv.currentVersion)) || inv.snapshots[inv.snapshots.length - 1];
}
