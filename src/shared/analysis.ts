/* Pure, reproducible analyses used by the existing investigation engine. No network or models. */
import { cleanText, safeHttpsUrl } from './sanitize.ts';
import { topicTags } from './topics.ts';
import type { Post, SourceDocument, MediaObservation, Claim } from './schemas.ts';

export function normalized(text: string): string {
  return cleanText(text, 100000)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function normalizedUrl(raw: string): string | null {
  const safe = safeHttpsUrl(raw);
  if (!safe) return null;
  const u = new URL(safe);
  u.hash = '';
  for (const key of [...u.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return u.href.replace(/\/$/, '');
}
export function similarity(a: string, b: string): number {
  const A = new Set(normalized(a).split(' ').filter(Boolean)),
    B = new Set(normalized(b).split(' ').filter(Boolean));
  if (Math.min(A.size, B.size) < 6) return normalized(a) === normalized(b) && A.size ? 1 : 0;
  return [...A].filter((x) => B.has(x)).length / new Set([...A, ...B]).size;
}
export function narrativeAnalysis(posts: Post[]) {
  const clusters: { label: string; postIds: string[]; method: string }[] = [];
  for (const p of posts) {
    if (!normalized(p.text)) continue;
    const cluster = clusters.find(
      (c) => similarity(posts.find((p) => p.id === c.postIds[0])!.text, p.text) >= 0.65,
    );
    if (cluster) cluster.postIds.push(p.id);
    else
      clusters.push({
        label: cleanText(p.text, 140),
        postIds: [p.id],
        method: 'normalized word-set Jaccard >= 0.65 against cluster representative',
      });
  }
  const regions = [...new Set(posts.flatMap((p) => topicTags(p.text)))].map((topic) => ({
    topic,
    postIds: posts.filter((p) => topicTags(p.text).includes(topic)).map((p) => p.id),
  }));
  const phraseMap = new Map<string, Set<string>>();
  for (const p of posts) {
    const words = normalized(p.text).split(' ');
    for (let size = 4; size <= 8; size++)
      for (let i = 0; i <= words.length - size; i++) {
        const phrase = words.slice(i, i + size).join(' ');
        const ids = phraseMap.get(phrase) || new Set<string>();
        ids.add(p.id);
        phraseMap.set(phrase, ids);
      }
  }
  const sentences = new Set(posts.flatMap((p) => p.text.split(/[.!?]+/).map(normalized)));
  const all = [...phraseMap]
    .filter(([, ids]) => ids.size >= 2)
    .map(([phrase, ids]) => ({ phrase, postIds: [...ids] }));
  const phrases = all
    .filter(
      (a) =>
        sentences.has(a.phrase) ||
        !all.some(
          (b) =>
            b.phrase !== a.phrase &&
            b.phrase.includes(a.phrase) &&
            b.postIds.length === a.postIds.length,
        ),
    )
    .sort((a, b) => b.postIds.length - a.postIds.length || a.phrase.localeCompare(b.phrase))
    .slice(0, 50);
  return {
    total: posts.length,
    clusters: clusters.sort((a, b) => b.postIds.length - a.postIds.length),
    regions,
    phrases,
    geographicPostIds: posts
      .filter((p) => topicTags(p.text).some((t) => t === 'US' || t === 'EU'))
      .map((p) => p.id),
    overlaps: posts.filter((p) => topicTags(p.text).length > 1).map((p) => p.id),
    method:
      'Keyword region lexicon; mutually exclusive representative clusters; 4–8-word normalized phrases. Similar text does not establish a shared operator.',
  };
}

export function writingAnalysis(posts: Post[], minimum = 8) {
  const sorted = posts
    .filter((p) => p.createdAt && p.text)
    .sort((a, b) => a.createdAt!.localeCompare(b.createdAt!));
  const changes: { label: string; before: string; after: string; feature: string }[] = [];
  const templates: string[][] = [];
  for (const p of sorted) {
    const found = templates.find(
      (ids) => similarity(sorted.find((q) => q.id === ids[0])!.text, p.text) >= 0.85,
    );
    if (found) found.push(p.id);
    else templates.push([p.id]);
  }
  if (sorted.length >= minimum) {
    const half = Math.floor(sorted.length / 2),
      before = sorted.slice(0, half),
      after = sorted.slice(half);
    const features: [string, (p: Post) => number][] = [
      ['US spelling markers', (p) => Number(/\b(color|favorite|organize|center)\b/i.test(p.text))],
      [
        'UK spelling markers',
        (p) => Number(/\b(colour|favourite|organise|centre)\b/i.test(p.text)),
      ],
      ['ISO date format', (p) => Number(/\b\d{4}-\d{2}-\d{2}\b/.test(p.text))],
      ['slash date format', (p) => Number(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(p.text))],
      ['repeated punctuation', (p) => Number(/[!?]{2,}/.test(p.text))],
      ['long posts (over 180 characters)', (p) => Number(p.text.length > 180)],
    ];
    for (const [feature, f] of features) {
      const a = before.reduce((n, p) => n + f(p), 0) / before.length,
        b = after.reduce((n, p) => n + f(p), 0) / after.length;
      if (Math.abs(a - b) >= 0.6) {
        const p = before.find((p) => f(p) === (a > b ? 1 : 0)),
          q = after.find((p) => f(p) === (b > a ? 1 : 0));
        if (p && q)
          changes.push({ label: 'WRITING PATTERN CHANGE', before: p.id, after: q.id, feature });
      }
    }
  }
  return {
    examined: sorted.length,
    minimum,
    label:
      sorted.length < minimum
        ? 'INSUFFICIENT SAMPLE'
        : changes.length
          ? 'WRITING PATTERN CHANGE'
          : 'No material change detected in measured features',
    changes,
    templates: templates.filter((ids) => ids.length >= 2),
    limitations:
      'Within-account comparison only. Editing, translation, scheduling and multiple authorized authors can change style. No native-speaker, identity or deceptive-author score.',
  };
}

// Word-cluster normalization intentionally drops punctuation. Factual comparisons must keep
// signs, units, decimal separators and ratios: "10%" cannot become the assertion "10".
function comparisonText(text: string): string {
  return cleanText(text, 100000)
    .toLowerCase()
    .replace(/[−–]/g, '-')
    .replace(/[^\p{L}\p{N}\s%$€£¥+.,\/\-]/gu, ' ')
    .replace(/(?<!\d)[.,]|[.,](?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compare only explicitly scoped passages contained in the retrieved source. No semantic truth guesses. */
export function comparePassage(
  claim: string,
  passage: string,
  source: SourceDocument,
): { status: Claim['status']; detail: string } {
  if (!source.text.includes(passage) || !passage.trim() || !source.publishedAt)
    return {
      status: 'unverified',
      detail:
        'Original passage or publication date unavailable; comparison cannot establish a dated source finding.',
    };
  const a = comparisonText(claim),
    b = comparisonText(passage);
  if (a === b)
    return {
      status: 'supported',
      detail:
        'Exact normalized assertion matches the dated source passage. This establishes source agreement, not universal truth.',
    };
  const numbers = (s: string) => s.match(/\b\d+(?:\.\d+)?\b/g) || [];
  const skeleton = (s: string) => s.replace(/\b\d+(?:\.\d+)?\b/g, '#');
  if (skeleton(a) === skeleton(b) && numbers(a).join() !== numbers(b).join())
    return {
      status: 'contradicted',
      detail:
        'Same wording and scope, but numerical values differ from the dated source: ' +
        numbers(a).join(', ') +
        ' versus ' +
        numbers(b).join(', ') +
        '.',
    };
  const noNeg = (s: string) =>
    s
      .replace(/\b(?:not|never|no)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  if (noNeg(a) === noNeg(b))
    return {
      status: 'contradicted',
      detail:
        'Negation differs in otherwise identical wording; inspect both passages for inverted meaning.',
    };
  const qualifiers =
    /\b(?:may|might|could|approximately|estimated|allegedly|reportedly|some|up to|at least)\b/g;
  const stripped = b.replace(qualifiers, '').replace(/\s+/g, ' ').trim();
  if (a === stripped && a !== b)
    return {
      status: 'misleading_context',
      detail: 'The excerpt removes a qualifier present in the original passage.',
    };
  if (b.includes(a) && a.length >= 20)
    return {
      status: 'unverified',
      detail: 'Excerpt occurs in the original passage. Omitted context needs human interpretation.',
    };
  return {
    status: 'unverified',
    detail:
      'Wording or scope differs. Deterministic comparison cannot establish factual agreement.',
  };
}
export function claimAutopsy(text: string, sources: SourceDocument[]) {
  const matches = sources.flatMap((s) =>
    (s.comparisons || [])
      .filter((c) => comparisonText(c.claim) === comparisonText(text))
      .map((c) => ({ source: s, comparison: c, ...comparePassage(text, c.passage, s) })),
  );
  const decisive = matches.filter((x) => x.status !== 'unverified'),
    statuses = new Set(decisive.map((x) => x.status));
  const status: Claim['status'] =
    statuses.size > 1
      ? 'mixed_evidence'
      : decisive[0]?.status ||
        (/^(?:i (?:think|feel|prefer|love)|in my opinion)\b/i.test(text) || /\?$/.test(text.trim())
          ? 'not_factual'
          : 'unverified');
  return {
    status,
    matches,
    explanation: matches.length
      ? matches.map((m) => m.detail).join(' ')
      : 'No dated source passage scoped to this assertion. Source discovery and human review remain necessary.',
  };
}
export function mediaComparison(media: MediaObservation[]) {
  const matches: {
    a: number;
    b: number;
    distance: number;
    earlier: string | null;
    dateConflict: boolean;
  }[] = [];
  for (let i = 0; i < media.length; i++)
    for (let j = i + 1; j < media.length; j++) {
      let bits = BigInt('0x' + media[i].hash) ^ BigInt('0x' + media[j].hash),
        distance = 0;
      while (bits) {
        distance += Number(bits & 1n);
        bits >>= 1n;
      }
      if (distance <= 8) {
        const a = media[i],
          b = media[j],
          dated = [a, b]
            .filter((x) => x.publishedAt)
            .sort((a, b) => a.publishedAt!.localeCompare(b.publishedAt!));
        const earlier = dated[0]?.publishedAt || null;
        matches.push({
          a: i,
          b: j,
          distance,
          earlier,
          dateConflict:
            !!earlier && [a, b].some((x) => !!x.claimedEventDate && x.claimedEventDate > earlier),
        });
      }
    }
  return {
    matches,
    method:
      '64-bit difference hash; Hamming distance <= 8. Similarity is a review candidate, not proof of the same event. Dates and metadata are user-supplied; C2PA signatures are not verified.',
  };
}
