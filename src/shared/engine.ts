/* One deterministic engine: authorized observations -> versioned evidence -> seven-stage story. */
import * as C from './countries.ts';
import { hashId } from './hash.ts';
import { activityPattern, classifySource, countryFromStatedLocation, countryName } from './geo.ts';
import {
  normalized,
  normalizedUrl,
  similarity,
  matchesWording,
  wordingMethod,
  narrativeAnalysis,
  writingAnalysis,
  claimAutopsy,
  mediaComparison,
  reviewedCorroboration,
} from './analysis.ts';
import { cleanText, violatesBoundaries } from './sanitize.ts';
import {
  Account,
  AccountObservation,
  Claim,
  ENGINE_VERSION,
  Evidence,
  Finding,
  Investigation,
  InvestigationEvent,
  Post,
  RelationshipEdge,
  SCHEMA_VERSION,
  Snapshot,
  SourceDocument,
  MediaObservation,
} from './schemas.ts';

export const MAX_EVENTS = 200,
  MAX_SNAPSHOTS = 20,
  MAX_EVIDENCE = 600;
export function investigationId(handle: string) {
  return hashId('inv', 'account', handle.toLowerCase());
}
type NewEvidence = Omit<Evidence, 'id' | 'firstSeenAt' | 'lastSeenAt'>;
function mkEvidence(e: NewEvidence): Evidence {
  // Retrieval time is not identity. Content, source, provenance and subject are.
  const value = { ...e.value };
  if (value.document) {
    const d = { ...(value.document as any) };
    delete d.retrievedAt;
    value.document = d;
  }
  if (value.media) {
    const m = { ...(value.media as any) };
    delete m.observedAt;
    if (m.verification) {
      m.verification = { ...m.verification };
      delete m.verification.checkedAt;
    }
    if (m.instances)
      m.instances = m.instances.map((i: any) => {
        const item = { ...i };
        delete item.retrievedAt;
        return item;
      });
    value.media = m;
  }
  return Evidence.parse({
    ...e,
    id: hashId(
      'ev',
      e.source,
      e.provider,
      e.provenance,
      e.kind,
      e.subject.toLowerCase(),
      e.url,
      value,
    ),
    firstSeenAt: e.observedAt,
    lastSeenAt: e.observedAt,
  });
}
export function evidenceFromObservation(input: AccountObservation): Evidence[] {
  const obs = AccountObservation.parse(input),
    h = obs.handle,
    out: Evidence[] = [];
  const add = (e: NewEvidence) => out.push(mkEvidence(e));
  const provider = obs.provider || 'UserEvidenceProvider';
  if (obs.about) {
    const a = obs.about;
    const provenance = a.provenance || 'user_captured';
    if (provenance === 'platform_reported' && provider !== 'XOfficialProvider')
      throw new Error('Untrusted platform provenance');
    const common = {
      subject: h,
      source: 'user_evidence' as const,
      provider,
      provenance,
      url: a.sourceUrl || 'https://x.com/' + h + '/about',
      observedAt: a.observedAt,
    };
    if (a.notFound || (!a.basedIn && a.accurate === null && !a.source))
      add({
        ...common,
        kind: 'about_unavailable',
        summary: 'User observation: About fields unavailable.',
        value: { notFound: a.notFound },
      });
    if (a.basedIn) {
      const country = C.findCountry(a.basedIn)?.code || null;
      add({
        ...common,
        kind: 'about_based_in',
        displayRole: 'E-01',
        summary: 'USER-CAPTURED X DISPLAY: ' + cleanText(a.basedIn, 80),
        value: {
          basedIn: cleanText(a.basedIn, 80),
          country,
          isRegion: !country,
          original: a.basedIn,
        },
      });
    }
    if (a.source) {
      const c = classifySource(a.source);
      add({
        ...common,
        kind: 'about_connected_via',
        displayRole: 'E-02',
        summary: 'USER-CAPTURED X DISPLAY: ' + cleanText(a.source, 80),
        value: {
          raw: cleanText(a.source, 80),
          country: c.country ? C.findCountry(c.country)?.code || null : null,
        },
      });
    }
    if (a.accurate !== null)
      add({
        ...common,
        kind: 'about_location_accuracy',
        displayRole: 'E-03',
        summary: a.accurate
          ? 'User observed no accuracy warning; this does not prove absence of VPN.'
          : 'User observed an accuracy warning.',
        value: { accurate: a.accurate, original: a.displayText || null },
      });
  }
  if (obs.profileLocation) {
    const text = cleanText(obs.profileLocation.text, 120);
    if (text)
      add({
        kind: 'profile_location',
        source: provider === 'XOfficialProvider' ? 'x_official' : 'user_evidence',
        provider,
        provenance: 'self_described',
        subject: h,
        url: 'https://x.com/' + h,
        observedAt: obs.profileLocation.observedAt,
        summary: 'Self-described: ' + text,
        value: { text, country: countryFromStatedLocation(text) },
        displayRole: 'E-04',
      });
  }
  const seen = new Map<string, string>();
  for (const raw of obs.posts) {
    const p = Post.parse({ ...raw, text: cleanText(raw.text, 4000) });
    const fingerprint = JSON.stringify(p),
      existing = seen.get(p.id);
    if (existing && existing !== fingerprint)
      throw new Error('Conflicting repeated post id ' + p.id);
    if (existing) continue;
    seen.set(p.id, fingerprint);
    if (p.createdAt && Date.parse(p.createdAt) > Date.parse(obs.observedAt) + 60000)
      throw new Error('Post creation time is after retrieval');
    add({
      kind: 'post',
      source: p.capturedFrom,
      provider: p.capturedFrom === 'x_official' ? 'XOfficialProvider' : provider,
      provenance:
        p.capturedFrom === 'x_official'
          ? 'platform_reported'
          : p.capturedFrom === 'public_evidence'
            ? 'external_source'
            : 'user_captured',
      subject: p.handle,
      url: p.url,
      observedAt: obs.observedAt,
      publishedAt: p.createdAt || undefined,
      summary: cleanText(p.text, 160) || '(no text)',
      value: { post: p },
    });
  }
  for (const document of obs.sources || [])
    add({
      kind: 'source_document',
      source: document.provenance === 'user_captured' ? 'user_evidence' : 'public_evidence',
      provider: document.provider,
      provenance: document.provenance,
      subject: h,
      url: document.url,
      observedAt: document.retrievedAt,
      publishedAt: document.publishedAt || undefined,
      summary: document.title,
      value: { document },
    });
  for (const m of obs.media || [])
    add({
      kind: 'media',
      source: 'user_evidence',
      provider: 'UserEvidenceProvider',
      provenance: 'user_captured',
      subject: h,
      url: m.url,
      observedAt: m.observedAt,
      publishedAt: m.publishedAt || undefined,
      summary: 'User-supplied media fingerprint',
      value: { media: m },
    });
  const own = out.filter((e) => e.kind === 'post' && e.subject.toLowerCase() === h.toLowerCase());
  const posts = own.map((e) => e.value.post as Post);
  if (posts.length) {
    const derived = {
      source: 'derived' as const,
      provider: 'deterministic',
      provenance: 'derived' as const,
      subject: h,
      observedAt: obs.observedAt,
      derivedFrom: own.map((e) => e.id),
      coverage: obs.coverage,
    };
    const activity = activityPattern(posts.map((p) => p.createdAt || ''));
    add({
      ...derived,
      kind: 'activity_pattern',
      displayRole: 'E-05',
      summary: 'POSTING HOURS ARE A WEAK CONTEXTUAL SIGNAL',
      value: { ...activity },
    });
    add({
      ...derived,
      kind: 'writing_pattern',
      summary: 'Within-account writing comparison',
      value: { ...writingAnalysis(posts) },
    });
    add({
      ...derived,
      kind: 'narrative_distribution',
      displayRole: 'E-06',
      summary: 'Observed topic and narrative distribution',
      value: { ...narrativeAnalysis(posts) },
    });
    const languages: Record<string, number> = {};
    for (const p of posts) if (p.lang) languages[p.lang] = (languages[p.lang] || 0) + 1;
    if (Object.keys(languages).length)
      add({
        ...derived,
        kind: 'post_languages',
        summary: 'Provider language tags; no identity inference.',
        value: { languages },
      });
  }
  const all = out.filter((e) => e.kind === 'post');
  const seed =
    obs.searchText || posts.find((p) => p.id === obs.focusPostId)?.text || posts[0]?.text;
  if (seed && all.length) {
    const method = wordingMethod(seed);
    const matches = all.filter((e) => matchesWording((e.value.post as Post).text, seed, method));
    const dated = matches
      .filter((e) => (e.value.post as Post).createdAt)
      .sort(
        (a, b) =>
          Date.parse((a.value.post as Post).createdAt!) -
          Date.parse((b.value.post as Post).createdAt!),
      );
    const start = (dated[0]?.value.post as Post | undefined)?.createdAt || null,
      end = (dated.at(-1)?.value.post as Post | undefined)?.createdAt || null;
    const windows: Record<string, string[]> = {};
    for (const e of dated) {
      const p = e.value.post as Post;
      const key = new Date(Math.floor(Date.parse(p.createdAt!) / 3600000) * 3600000).toISOString();
      (windows[key] ||= []).push(p.id);
    }
    const amplifiers = dated.filter((e) => {
      const p = e.value.post as Post;
      return !!p.quotedPostId && (p.followers || 0) >= 10000;
    });
    add({
      kind: 'propagation',
      source: 'derived',
      provider: 'deterministic',
      provenance: 'derived',
      subject: h,
      observedAt: obs.observedAt,
      displayRole: 'E-07',
      summary: 'Matching wording within observed coverage',
      derivedFrom: all.map((e) => e.id),
      coverage: obs.coverage,
      value: {
        query: seed,
        method,
        examinedPostIds: all.map((e) => (e.value.post as Post).id),
        postIds: matches.map((e) => (e.value.post as Post).id),
        accounts: [...new Set(matches.map((e) => e.subject.toLowerCase()))],
        start,
        end,
        windows,
        earliestPostId: (dated[0]?.value.post as Post | undefined)?.id || null,
        earliestEvidenceId: dated[0]?.id || null,
        amplifierPostId: (amplifiers[0]?.value.post as Post | undefined)?.id || null,
        amplifierCriteria:
          'Earliest observed quote with >= 10,000 followers. Followers are not measured reach; causation remains undetermined.',
        missingDates: matches.length - dated.length,
      },
    });
  }
  return [...new Map(out.map((e) => [e.id, e])).values()];
}
export function mergeEvidence(existing: Evidence[], incoming: Evidence[]): Evidence[] {
  const map = new Map(existing.map((e) => [e.id, { ...e }]));
  for (const e of incoming) {
    const p = map.get(e.id);
    if (p) {
      if (e.lastSeenAt > p.lastSeenAt) p.lastSeenAt = e.lastSeenAt;
    } else map.set(e.id, e);
  }
  return [...map.values()];
}
type F = Omit<Finding, 'id' | 'caveats' | 'strength'> & { caveats?: string[]; claimScope?: string };
function finding(f: F, current: Evidence[]): Finding {
  const evidenceIds = [...new Set(f.evidenceIds)].sort(),
    ev = current.filter((e) => evidenceIds.includes(e.id));
  const direct = ev.filter(
    (e) => e.provenance === 'external_source' || e.provenance === 'platform_reported',
  );
  const domains = new Set(direct.flatMap((e) => (e.url ? [new URL(e.url).hostname] : [])));
  // Independent corroboration requires explicit dependency review; domain count alone never earns 3 bars.
  const corroboration = f.claimScope
    ? reviewedCorroboration(
        f.claimScope,
        current
          .filter((e) => e.kind === 'source_document')
          .map((e) => e.value.document as SourceDocument),
      )
    : null;
  const bars = corroboration?.eligible
    ? 3
    : ev.length >= 2 && direct.length > 0 && f.status !== 'conflict'
      ? 2
      : 1;
  const { claimScope: _, ...fields } = f;
  return Finding.parse({
    ...fields,
    caveats: f.caveats || [],
    evidenceIds,
    id: hashId('fd', f.title, f.statement, evidenceIds),
    strength: {
      bars,
      reasons: [
        `${ev.length} supporting observations; ${domains.size} direct source domains.`,
        f.status === 'conflict'
          ? 'Conflicting evidence reduces strength.'
          : 'Source independence is not established by different domains.',
        'Three bars require independently corroborated direct evidence; not inferred from count alone.',
        ...(corroboration?.reasons || []),
      ],
    },
  });
}
export interface Analysis {
  account: Account;
  findings: Finding[];
  claims: Claim[];
  edges: RelationshipEdge[];
  posts: Post[];
  headline: string;
  story: NonNullable<Snapshot['story']>;
  displayRoles: Record<string, string[]>;
}
export function analyze(handle: string, current: Evidence[]): Analysis {
  const h = handle.toLowerCase(),
    mine = current.filter((e) => e.subject.toLowerCase() === h);
  const one = (kind: Evidence['kind']) =>
    mine
      .filter((e) => e.kind === kind)
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
  const based = one('about_based_in'),
    via = one('about_connected_via'),
    acc = one('about_location_accuracy'),
    prof = one('profile_location'),
    act = one('activity_pattern'),
    writing = one('writing_pattern'),
    topics = one('narrative_distribution'),
    prop = one('propagation');
  const fs: Finding[] = [],
    claims: Claim[] = [],
    edges: RelationshipEdge[] = [];
  const add = (f: F) => {
    const x = finding(f, current);
    fs.push(x);
    return x;
  };
  const info = (
    capability: Finding['capability'],
    title: string,
    statement: string,
    ev: Evidence[],
    status: Finding['status'] = 'info',
    caveats: string[] = [],
  ) =>
    add({
      capability,
      title,
      statement: cleanText(statement, 600),
      basis: ev.length ? 'inferred' : 'unknown',
      status,
      confidence: ev.length ? 'low' : 'none',
      country: null,
      evidenceIds: ev.map((e) => e.id),
      caveats,
    });
  const bc = (based?.value.country as string | null) || null,
    pc = (prof?.value.country as string | null) || null;
  add({
    capability: 'origin',
    title: 'Account based in',
    statement: based
      ? `${based.provenance === 'platform_reported' ? 'Platform report' : 'USER-CAPTURED X DISPLAY'}: ${based.value.basedIn}${based.value.isRegion ? ' (region, not a country)' : ''}.`
      : 'UNAVAILABLE: no authorized source for X-reported operating region.',
    basis: based ? 'reported' : 'unknown',
    status: based ? 'info' : 'undetermined',
    confidence: based ? 'low' : 'none',
    country: bc,
    evidenceIds: based ? [based.id] : [],
    caveats: [
      'An operating-region display does not establish physical location or factual accuracy.',
    ],
  });
  info(
    'origin',
    'Connected via',
    via
      ? `USER-CAPTURED X DISPLAY: ${via.value.raw}. App-store region is not physical location.`
      : 'UNAVAILABLE: connection/app-store region.',
    via ? [via] : [],
  );
  info(
    'vpn',
    'X location-accuracy note',
    acc
      ? acc.value.accurate === false
        ? 'USER-CAPTURED X DISPLAY: accuracy warning present; possible VPN/proxy uncertainty.'
        : 'User observed no warning. This does not prove no VPN.'
      : 'UNAVAILABLE: location-accuracy note.',
    acc ? [acc] : [],
  );
  add({
    capability: 'origin',
    title: 'Profile location',
    statement: prof
      ? `Self-described: “${prof.value.text}”. ${pc ? 'Conservatively normalized to ' + countryName(pc) + '.' : 'Ambiguous or undetermined.'}`
      : 'UNAVAILABLE: self-described location.',
    basis: prof ? 'self-described' : 'unknown',
    status: 'info',
    confidence: prof ? 'low' : 'none',
    country: pc,
    evidenceIds: prof ? [prof.id] : [],
    caveats: [],
  });
  const conflict = !!bc && !!pc && bc !== pc;
  info(
    'origin',
    'Location comparison',
    !based || !prof
      ? 'Insufficient evidence to compare the fields.'
      : !bc || !pc
        ? 'Ambiguous: one or both fields cannot be normalized to a country.'
        : conflict
          ? 'Contradictory fields: the profile and platform display name different countries. The reason remains unknown.'
          : 'Consistent fields: both name the same country.',
    [based, prof].filter((e): e is Evidence => !!e),
    conflict ? 'conflict' : bc && pc ? 'consistent' : 'undetermined',
    [
      'Travel, relocation, organizations, shared accounts, jokes and stale information can explain disagreements.',
    ],
  );
  info(
    'vpn',
    'Posting-hour pattern',
    act ? `${act.summary}. ${act.value.reason}` : 'INSUFFICIENT SAMPLE: no timestamped posts.',
    act ? [act] : [],
    'undetermined',
    [
      'Schedulers, shift work, travel and content teams can produce misleading patterns. No precise routine or location is inferred.',
    ],
  );
  info(
    'narrative',
    'Writing pattern',
    writing ? String(writing.value.label) : 'INSUFFICIENT SAMPLE',
    writing ? [writing] : [],
    'info',
    ['Within-account textual differences do not establish authorship or identity.'],
  );
  if (topics) {
    const v = topics.value as ReturnType<typeof narrativeAnalysis>,
      top = v.clusters[0];
    info(
      'narrative',
      'N-1 Narrative concentration',
      top
        ? `${top.postIds.length} of ${v.total} observed posts in the largest wording cluster. Method: normalized word-set similarity, not a semantic verdict.`
        : 'No textual cluster detected.',
      [topics],
    );
    info(
      'narrative',
      'N-2 Geographic topic focus',
      `${v.geographicPostIds.length} of ${v.total} observed posts match US/EU topic keywords. ${v.overlaps.length} posts have overlapping region classifications.`,
      [topics],
      'info',
      ['Discussion of another country’s politics is not misconduct.'],
    );
    info(
      'narrative',
      'N-3 Repeated phrases',
      v.phrases.length
        ? `${v.phrases.length} repeated 4–8-word phrases in ${v.total} posts; inspect each counted instance.`
        : 'No repeated phrases detected in the observed sample.',
      [topics],
    );
  } else
    info(
      'narrative',
      'Narrative focus',
      'UNAVAILABLE: no account post sample.',
      [],
      'undetermined',
    );
  const postEv = current.filter((e) => e.kind === 'post'),
    posts = postEv.map((e) => e.value.post as Post),
    docsEv = current.filter((e) => e.kind === 'source_document'),
    sources = docsEv.map((e) => e.value.document as SourceDocument);
  if (prop) {
    const v = prop.value as any;
    info(
      'narrative',
      'Copies and amplification',
      `${v.postIds.length} matching posts from ${v.accounts.length} distinct observed accounts. ${v.start && v.end ? 'Observed interval: ' + v.start + ' to ' + v.end + '.' : 'Creation timestamps unavailable.'} Counts cover retrieved observations only.${v.method === 'quoted-phrase@1' ? ' Exact normalized phrase occurrences; this does not establish copied whole posts or the same factual claim.' : ''}`,
      [prop],
    );
    const earliest = postEv.find((e) => (e.value.post as Post).id === v.earliestPostId);
    info(
      'narrative',
      'EARLIEST OBSERVED COPY',
      earliest
        ? `${earliest.url} at ${(earliest.value.post as Post).createdAt}. Earliest within the searched sample; origin is not established.`
        : 'UNAVAILABLE: no dated matching post.',
      earliest ? [earliest] : [],
    );
    const amplifier = postEv.find((e) => (e.value.post as Post).id === v.amplifierPostId);
    info(
      'narrative',
      'Amplifier observation',
      amplifier
        ? `${amplifier.url}. ${v.amplifierCriteria}`
        : 'AMPLIFICATION UNDETERMINED: no qualifying engagement-backed quote observation.',
      amplifier ? [amplifier] : [],
    );
    info(
      'narrative',
      'Synchronization',
      v.accounts.length === 0
        ? 'Insufficient matching observations to assess synchronization.'
        : v.accounts.length > 1
          ? 'Repeated wording across accounts is observable; it does not establish common ownership, automation or sponsorship.'
          : 'No meaningful coordination detected in the observed sample.',
      [prop],
    );
  } else
    info(
      'narrative',
      'EARLIEST OBSERVED COPY',
      'UNAVAILABLE: no matching-post search results.',
      [],
      'undetermined',
    );
  const edge = (type: RelationshipEdge['type'], from: string, to: string, ids: string[]) => {
    const id = hashId('ed', type, from, to),
      existing = edges.find((e) => e.id === id);
    if (existing) existing.evidenceIds = [...new Set([...existing.evidenceIds, ...ids])];
    else edges.push(RelationshipEdge.parse({ id, type, from, to, evidenceIds: [...new Set(ids)] }));
  };
  for (const e of postEv) {
    const p = e.value.post as Post,
      from = 'post:' + p.id;
    edge('authored', 'account:' + p.handle.toLowerCase(), from, [e.id]);
    if (p.quotedPostId) edge('quotes', from, 'post:' + p.quotedPostId, [e.id]);
    if (p.replyToHandle)
      edge('replies_to', from, 'account:' + p.replyToHandle.toLowerCase(), [e.id]);
    if (p.repostOfId) edge('reposts', from, 'post:' + p.repostOfId, [e.id]);
    for (const l of p.links) {
      const u = normalizedUrl(l);
      if (u) {
        edge('links_to', from, u, [e.id]);
        edge('links_to', u, 'source-domain:' + new URL(u).hostname, [e.id]);
      }
    }
    if (p.handle.toLowerCase() === h && p.text.length >= 10) {
      const sentences = p.text
        .split(/(?<=[.!?])\s+/)
        .filter((t) => t.length >= 10)
        .slice(0, 5);
      for (const text of sentences) {
        const result = claimAutopsy(text, sources),
          ids = [
            e.id,
            ...result.matches.map(
              (m) =>
                docsEv.find((e) => (e.value.document as SourceDocument).url === m.source.url)!.id,
            ),
          ];
        const c = Claim.parse({
          id: hashId('cl', p.id, text),
          postId: p.id,
          text: cleanText(text, 1000),
          status: result.status,
          evidenceIds: [...new Set(ids)],
          explanation: cleanText(result.explanation, 4000),
        });
        claims.push(c);
        edge('references_claim', from, 'claim:' + c.id, [e.id]);
      }
    }
  }
  for (let i = 0; i < postEv.length; i++)
    for (let j = i + 1; j < postEv.length; j++) {
      const a = postEv[i],
        b = postEv[j],
        p = a.value.post as Post,
        q = b.value.post as Post;
      if (normalized(p.text).length >= 20 && similarity(p.text, q.text) >= 0.8)
        edge(
          normalized(p.text) === normalized(q.text) ? 'exact_duplicate' : 'near_duplicate',
          'post:' + p.id,
          'post:' + q.id,
          [a.id, b.id],
        );
      const common = p.links
        .map(normalizedUrl)
        .find((u) => u && q.links.map(normalizedUrl).includes(u));
      if (common) edge('shares_url', 'post:' + p.id, 'post:' + q.id, [a.id, b.id]);
    }
  const dependencies = new Map<string, Evidence[]>();
  for (const e of docsEv) {
    const d = e.value.document as SourceDocument;
    for (const raw of d.citations) {
      const u = normalizedUrl(raw);
      if (!u) continue;
      edge('cites', normalizedUrl(d.url)!, u, [e.id]);
      const list = dependencies.get(u) || [];
      if (!list.includes(e)) list.push(e);
      dependencies.set(u, list);
    }
  }
  for (const [url, ev] of dependencies)
    if (ev.length > 1)
      info(
        'claims',
        'Shared source dependency',
        `${ev.length} retrieved documents link to ${url}. Repeated attribution is not independent corroboration; the referenced source may remain unverified.`,
        ev,
      );
  for (const e of docsEv) {
    const d = e.value.document as SourceDocument;
    for (const c of d.comparisons || []) {
      const r = claimAutopsy(c.claim, [d]);
      info(
        'claims',
        c.kind === 'quote'
          ? 'Quote Reconstruction'
          : c.kind === 'organizational'
            ? 'Organizational contradiction ledger'
            : 'Source passage comparison',
        r.status + ': ' + r.explanation,
        [e],
        r.status === 'contradicted' ? 'conflict' : 'info',
      );
    }
    for (const f of d.factChecks || [])
      info(
        'claims',
        'Existing fact check',
        `${f.publisher}: ${f.rating}; claim: ${f.claim}; date: ${f.date || 'unavailable'}; ${f.url}`,
        [e],
        'info',
        ['Publisher rating is evidence to inspect, not absolute truth.'],
      );
  }
  const reviewedClaims = [
    ...new Set(
      sources.flatMap((d) =>
        d.independenceReview ? (d.comparisons || []).map((c) => c.claim) : [],
      ),
    ),
  ];
  for (const claim of reviewedClaims) {
    const r = reviewedCorroboration(claim, sources);
    add({
      capability: 'claims',
      title: 'Reviewed source agreement',
      claimScope: claim,
      statement: cleanText(
        (r.eligible
          ? 'Corroborated passage agreement, conditional on recorded user independence reviews: '
          : 'Independence upgrade withheld: ') + claim,
        600,
      ),
      basis: r.eligible ? 'corroborated' : 'inferred',
      status: 'info',
      confidence: r.eligible ? 'medium' : 'low',
      country: null,
      evidenceIds: docsEv
        .filter((e) => r.sources.some((s) => s.url === (e.value.document as SourceDocument).url))
        .map((e) => e.id),
      caveats: [
        'Three bars refer to this narrow passage agreement under the recorded review. They are not a truth probability or an assessment of the account.',
      ],
    });
  }
  const mediaEv = current.filter((e) => e.kind === 'media');
  if (mediaEv.length) {
    const r = mediaComparison(mediaEv.map((e) => e.value.media as MediaObservation));
    info(
      'claims',
      'Media Time Machine',
      `${r.matches.length} perceptually similar pairs; ${r.matches.filter((m) => m.dateConflict).length} candidate date conflicts. ${r.method}`,
      mediaEv,
    );
    const checked = new Set<string>();
    for (const e of mediaEv) {
      const m = e.value.media as MediaObservation,
        key = m.sha256 || e.id;
      if (checked.has(key)) continue;
      checked.add(key);
      const v = m.verification;
      if (v)
        info(
          'claims',
          'Content Credentials',
          `Supplied file ${key.slice(0, 16)}: signature ${v.signature}; asset binding ${v.binding}; certificate trust ${v.trust}. SDK: ${v.sdkState}. Signer: ${v.issuer || 'unavailable'}.`,
          [e],
          v.signature === 'invalid' || v.binding === 'mismatch' ? 'conflict' : 'info',
          [
            'A valid signature does not prove the depicted event. URL association is user-supplied.',
            'Offline validation; remote manifests and online revocation checks are disabled.',
          ],
        );
      if (m.instances?.length) {
        const dated = m.instances
          .filter((i) => i.publishedAt)
          .sort((a, b) => Date.parse(a.publishedAt!) - Date.parse(b.publishedAt!));
        const earliest = dated[0],
          conflict =
            !!earliest &&
            !!m.claimedEventDate &&
            Date.parse(earliest.publishedAt!) < Date.parse(m.claimedEventDate);
        info(
          'claims',
          'Earlier media instances',
          `${m.instances.length} provider candidates. ${earliest ? 'Earliest observed repository upload: ' + earliest.publishedAt + '; ' + earliest.sourceUrl : 'No defensible publication dates returned.'}${conflict ? ' This precedes the user-claimed event date; review context.' : ''}`,
          [e],
          conflict ? 'conflict' : 'info',
          [
            'Repository upload time is not event time or proof of first publication. Exact-byte matches and visual candidates have different meanings.',
          ],
        );
        for (const instance of m.instances) edge('links_to', m.url, instance.sourceUrl, [e.id]);
      }
    }
  }
  info(
    'claims',
    'Community Notes',
    'UNAVAILABLE: no authorized Community Notes records in this snapshot.',
    [],
    'undetermined',
  );
  const account = Account.parse({
    handle,
    basedIn: based?.value.basedIn || null,
    basedInCountry: bc,
    basedInIsRegion: !!based?.value.isRegion,
    locationAccurate: acc?.value.accurate ?? null,
    connectedVia: via?.value.raw || null,
    profileLocation: prof?.value.text || null,
    aboutObservedAt: based?.observedAt || acc?.observedAt || via?.observedAt || null,
  });
  const headline = conflict
    ? 'Observed location fields disagree; cause unknown.'
    : `Investigation of @${handle}: ${posts.filter((p) => p.handle.toLowerCase() === h).length} account posts observed; location ${based ? 'display captured' : 'unavailable'}.`;
  const displayRoles: Record<string, string[]> = {};
  for (let i = 1; i <= 8; i++)
    displayRoles['E-0' + i] = current.filter((e) => e.displayRole === 'E-0' + i).map((e) => e.id);
  if (prop?.value.earliestEvidenceId)
    displayRoles['E-08'] = [String(prop.value.earliestEvidenceId)];
  for (const label of ['N-1', 'N-2', 'N-3']) displayRoles[label] = topics ? [topics.id] : [];
  const section = (title: string, selected: Finding[], fallback: string) => ({
    title,
    text: selected.map((f) => f.statement).join('\n') || fallback,
    evidenceIds: [...new Set(selected.flatMap((f) => f.evidenceIds))],
    findingIds: selected.map((f) => f.id),
  });
  const story = [
    section(
      '01 / REPORTED ORIGIN',
      fs.filter((f) =>
        ['Account based in', 'Connected via', 'X location-accuracy note'].includes(f.title),
      ),
      '',
    ),
    section(
      '02 / SELF-DESCRIBED LOCATION',
      fs.filter((f) => ['Profile location', 'Location comparison'].includes(f.title)),
      '',
    ),
    section(
      '03 / POSTING PATTERN',
      fs.filter((f) => f.title === 'Posting-hour pattern'),
      '',
    ),
    section(
      '04 / WRITING PATTERN',
      fs.filter((f) => f.title === 'Writing pattern'),
      '',
    ),
    section(
      '05 / NARRATIVE FOCUS',
      fs.filter((f) => /^N-[123]|^Narrative focus/.test(f.title)),
      '',
    ),
    section(
      '06 / SOURCE & AMPLIFICATION',
      fs.filter((f) =>
        [
          'Copies and amplification',
          'EARLIEST OBSERVED COPY',
          'Amplifier observation',
          'Synchronization',
        ].includes(f.title),
      ),
      '',
    ),
    {
      title: '07 / THE READ',
      text: [
        conflict
          ? 'The self-description conflicts with the captured platform display; the cause remains unknown.'
          : 'No established location contradiction.',
        ...fs
          .filter((f) =>
            [
              'Account based in',
              'Profile location',
              'Posting-hour pattern',
              'N-1 Narrative concentration',
              'EARLIEST OBSERVED COPY',
            ].includes(f.title),
          )
          .map((f) => f.statement),
        `${claims.filter((c) => !['unverified', 'not_factual'].includes(c.status)).length} of ${claims.length} post-claim candidates have scoped source comparisons. ${sources.reduce((n, d) => n + (d.comparisons?.length || 0), 0)} additional source-passage comparisons are recorded in Claims.`,
        'Unresolved: completeness of search, original source, source independence and causal amplification. Physical location and common control are not established.',
      ].join('\n'),
      evidenceIds: [...new Set(fs.flatMap((f) => f.evidenceIds))],
      findingIds: fs.map((f) => f.id),
    },
  ];
  return { account, findings: fs, claims, edges, posts, headline, story, displayRoles };
}
export interface ValidationIssue {
  findingId: string;
  problem: string;
}
export function validateFindings(raw: unknown[], evidence: Evidence[]) {
  const valid: Finding[] = [],
    issues: ValidationIssue[] = [],
    map = new Map(evidence.map((e) => [e.id, e]));
  for (const value of raw) {
    const result = Finding.safeParse(value),
      id = (value as any)?.id || 'unknown';
    let problem = '';
    if (!result.success) {
      issues.push({ findingId: id, problem: 'schema: ' + result.error.message });
      continue;
    }
    const f = result.data;
    if (f.evidenceIds.some((id) => !map.has(id)))
      problem =
        'cites evidence that does not exist: ' +
        f.evidenceIds.filter((id) => !map.has(id)).join(', ');
    else if (f.basis !== 'unknown' && !f.evidenceIds.length) problem = 'finding must cite evidence';
    else if (
      f.basis === 'reported' &&
      f.evidenceIds.every((id) => map.get(id)!.source === 'derived')
    )
      problem = 'reported finding must cite observed evidence';
    else if (
      f.country &&
      !f.evidenceIds.some(
        (id) =>
          map.get(id)!.value.country === f.country &&
          ['user_captured', 'platform_reported', 'self_described'].includes(
            map.get(id)!.provenance || '',
          ),
      )
    )
      problem = 'country ' + f.country + ' is not supported by appropriate provenance';
    else if (violatesBoundaries(f.title + ' ' + f.statement + ' ' + f.caveats.join(' ')))
      problem = 'crosses a hard boundary';
    if (problem) issues.push({ findingId: id, problem });
    else valid.push(f);
  }
  return { ok: issues.length === 0, valid, issues };
}
/** Reconstruct generated relationships and derived datasets. Never accept arbitrary model assertions. */
export function validateSnapshot(s: Snapshot, evidence: Evidence[]) {
  const current = evidence.filter((e) => s.evidenceIds.includes(e.id)),
    map = new Map(evidence.map((e) => [e.id, e]));
  if (s.evidenceIds.some((id) => !map.has(id)))
    throw new Error('Snapshot references missing evidence');
  for (const e of current)
    if (e.derivedFrom?.some((id) => !map.has(id)))
      throw new Error('Derived evidence references missing inputs');
  const expected = analyze(s.account.handle, current),
    expectedEdges = new Map(expected.edges.map((e) => [e.id, e]));
  for (const edge of s.edges)
    if (JSON.stringify(edge) !== JSON.stringify(expectedEdges.get(edge.id)))
      throw new Error('Relationship cannot be reconstructed');
  if (JSON.stringify(s.claims) !== JSON.stringify(expected.claims))
    throw new Error('Claims cannot be reconstructed');
  const expectedFindings = new Map(expected.findings.map((f) => [f.id, f]));
  for (const f of s.findings)
    if (JSON.stringify(f) !== JSON.stringify(expectedFindings.get(f.id)))
      throw new Error('Finding cannot be reconstructed');
  for (const e of current) {
    if (!e.url && e.source !== 'derived') throw new Error('Observed evidence needs a source URL');
    if (e.kind === 'activity_pattern') {
      const posts = (e.derivedFrom || []).map((id) => map.get(id)!.value.post as Post);
      if (
        JSON.stringify(activityPattern(posts.map((p) => p.createdAt || ''))) !==
        JSON.stringify(e.value)
      )
        throw new Error('Activity statistics do not match source dataset');
    }
    if (e.kind === 'writing_pattern') {
      const posts = (e.derivedFrom || []).map((id) => map.get(id)!.value.post as Post);
      if (JSON.stringify(writingAnalysis(posts)) !== JSON.stringify(e.value))
        throw new Error('Writing statistics do not match source dataset');
    }
    if (e.kind === 'propagation') {
      const v = e.value as any,
        examined = (e.derivedFrom || []).map((id) => map.get(id)!.value.post as Post),
        posts = examined.filter((p) => matchesWording(p.text, v.query, v.method || 'jaccard@1')),
        dated = posts
          .filter((p) => p.createdAt)
          .sort((a, b) => Date.parse(a.createdAt!) - Date.parse(b.createdAt!));
      if (
        JSON.stringify(posts.map((p) => p.id)) !== JSON.stringify(v.postIds) ||
        JSON.stringify([...new Set(posts.map((p) => p.handle.toLowerCase()))]) !==
          JSON.stringify(v.accounts) ||
        posts.some((p) => !matchesWording(p.text, v.query, v.method || 'jaccard@1')) ||
        v.start !== (dated[0]?.createdAt || null) ||
        v.end !== (dated.at(-1)?.createdAt || null) ||
        v.earliestPostId !== (dated[0]?.id || null)
      )
        throw new Error('Propagation statistics do not match source dataset');
    }
    if (e.kind === 'narrative_distribution') {
      const posts = (e.derivedFrom || []).map((id) => map.get(id)!.value.post as Post);
      if (JSON.stringify(narrativeAnalysis(posts)) !== JSON.stringify(e.value))
        throw new Error('Narrative statistics do not match source dataset');
    }
  }
}
function event(at: string, type: InvestigationEvent['type'], version: number, detail: string) {
  return InvestigationEvent.parse({ at, type, version, detail: cleanText(detail, 300) });
}
export function upsertInvestigation(
  existing: Investigation | null,
  raw: AccountObservation,
  now = new Date().toISOString(),
): Investigation {
  const obs = AccountObservation.parse(raw),
    id = investigationId(obs.handle),
    prev = existing ? Investigation.parse(existing) : null;
  if (prev && prev.id !== id) throw new Error('investigation id mismatch');
  const version = (prev?.currentVersion || 0) + 1,
    fresh = evidenceFromObservation(obs),
    a = analyze(obs.handle, fresh);
  const check = validateFindings(a.findings, fresh);
  const snap = Snapshot.parse({
    version,
    createdAt: now,
    engine: ENGINE_VERSION,
    adapterVersion: obs.adapterVersion,
    account: a.account,
    evidenceIds: fresh.map((e) => e.id),
    findings: check.valid,
    claims: a.claims,
    edges: a.edges,
    posts: a.posts,
    focusPostId: obs.focusPostId,
    headline: a.headline,
    story: a.story,
    displayRoles: a.displayRoles,
    coverage: obs.coverage || [],
    telemetry: obs.telemetry,
    correction: {
      previousVersion: prev?.currentVersion || null,
      reason: obs.correction || 'New observation snapshot; prior versions remain available.',
    },
  });
  validateSnapshot(snap, fresh);
  const snapshots = [...(prev?.snapshots || []), snap].slice(-MAX_SNAPSHOTS),
    retained = new Set(snapshots.flatMap((s) => s.evidenceIds));
  const evidence = mergeEvidence(prev?.evidence || [], fresh).filter((e) => retained.has(e.id));
  const events = [
    ...(prev?.events || []),
    event(
      now,
      prev ? 'refreshed' : 'created',
      version,
      obs.posts.length + ' submitted posts; ' + fresh.length + ' evidence records.',
    ),
    event(now, 'analyzed', version, check.valid.length + ' deterministic findings.'),
  ];
  if (!check.ok)
    events.push(
      event(now, 'validation_failed', version, check.issues.map((i) => i.problem).join('; ')),
    );
  return Investigation.parse(
    JSON.parse(
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        id,
        subject: { type: 'account', handle: obs.handle },
        createdAt: prev?.createdAt || now,
        updatedAt: now,
        currentVersion: version,
        evidence,
        snapshots,
        events: events.slice(-MAX_EVENTS),
      }),
    ),
  );
}
export function currentSnapshot(inv: Investigation, version?: number): Snapshot {
  const s = inv.snapshots.find((s) => s.version === (version ?? inv.currentVersion));
  if (!s) throw new Error('Snapshot version unavailable');
  return s;
}
