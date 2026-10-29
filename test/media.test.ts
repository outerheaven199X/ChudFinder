import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyMedia, mediaSearch } from '../server/media.ts';
import { session } from '../server/adapter.ts';
import { UserEvidenceProvider } from '../src/shared/providers.ts';
import { upsertInvestigation, currentSnapshot } from '../src/shared/engine.ts';
import { obs, post, T0 } from './helpers.ts';
import { matchingPassages, reviewedCorroboration } from '../src/shared/analysis.ts';
import type { SourceDocument } from '../src/shared/schemas.ts';
import { dateMetadata } from '../src/ext/media.ts';
import exifr from 'exifr';
const signed = readFileSync('test/fixtures/media/cai-signed.jpg');
test('native C2PA checks file binding, signature and trust separately; tampering is detected', async () => {
  const valid = await verifyMedia({ data: signed.toString('base64'), mimeType: 'image/jpeg' });
  assert.equal(valid.signature, 'validated');
  assert.equal(valid.binding, 'matched');
  assert.equal(valid.trust, 'untrusted');
  assert.ok(valid.codes.includes('signingCredential.untrusted'));
  assert.equal(valid.sha256, createHash('sha256').update(signed).digest('hex'));
  const altered = Buffer.from(signed);
  altered[altered.length - 100] ^= 1;
  const tampered = await verifyMedia({ data: altered.toString('base64'), mimeType: 'image/jpeg' });
  assert.equal(tampered.binding, 'mismatch');
  const unsigned = await verifyMedia({
    data: readFileSync('test/fixtures/media/cai-unsigned.jpg').toString('base64'),
    mimeType: 'image/jpeg',
  });
  assert.equal(unsigned.signature, 'absent');
  assert.equal(unsigned.trust, 'unverified');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    verifyMedia({ data: signed.toString('base64'), mimeType: 'image/jpeg' }, controller.signal),
    /Cancelled/,
  );
  const m = {
    url: 'https://example.org/image.jpg',
    observedAt: T0,
    publishedAt: null,
    claimedEventDate: null,
    hash: '0'.repeat(16),
    frameSeconds: null,
    metadata: {},
    provenance: 'user_captured' as const,
    sha256: valid.sha256,
    verification: valid,
  };
  const imported = new UserEvidenceProvider(obs('test', null, { media: [m] })).observation;
  assert.equal(imported.media![0].verification!.signature, 'unverified');
  const direct = upsertInvestigation(null, obs('test', null, { media: [m] }));
  assert.match(
    currentSnapshot(direct).findings.find((f) => f.title === 'Content Credentials')!.statement,
    /signature validated; asset binding matched; certificate trust untrusted/,
  );
});
test('Commons lookup verifies exact SHA-1 and preserves repository date scope', async () => {
  const sha1 = 'a'.repeat(40);
  const api: any = async () => ({
    query: {
      allimages: [
        {
          sha1,
          name: 'Example.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
          url: 'https://upload.wikimedia.org/example.jpg',
          timestamp: '2017-01-02T00:00:00Z',
        },
      ],
    },
  });
  const r = await mediaSearch({ sha1, provider: 'commons' }, session(), api);
  assert.equal(r.instances[0].match, 'exact_sha1');
  assert.equal(r.instances[0].dateBasis, 'repository_upload');
  assert.equal(r.coverage.complete, false);
  assert.equal(r.coverage.recordsExamined, 1);
  await assert.rejects(
    mediaSearch({ sha1: 'b'.repeat(40), provider: 'commons' }, session(), api),
    /different file hash/,
  );
  await assert.rejects(
    mediaSearch({ sha1, provider: 'commons' }, session(), (async () => ({ query: {} })) as any),
    /Malformed/,
  );
  const key = process.env.GOOGLE_VISION_API_KEY;
  delete process.env.GOOGLE_VISION_API_KEY;
  try {
    const unavailable = await mediaSearch(
      { imageUrl: 'https://example.org/x.jpg', provider: 'google' },
      session(),
      () => {
        throw new Error('Must not call provider');
      },
    );
    assert.equal(unavailable.coverage.status, 'unavailable');
  } finally {
    if (key) process.env.GOOGLE_VISION_API_KEY = key;
  }
});
test('chronology compares actual instants across explicit UTC offsets', () => {
  const inv = upsertInvestigation(
    null,
    obs('a', null, {
      posts: [
        post(
          '1',
          'a',
          'A repeated factual assertion with enough words to match exactly',
          '2026-10-01T10:00:00+02:00',
        ),
        post(
          '2',
          'b',
          'A repeated factual assertion with enough words to match exactly',
          '2026-10-01T09:00:00Z',
        ),
      ],
    }),
  );
  assert.equal(inv.evidence.find((e) => e.kind === 'propagation')!.value.earliestPostId, '1');
});
test('passage candidates retain source context and do not invent originals', () => {
  const d: SourceDocument = {
    url: 'https://example.org/source',
    provider: 'PublicEvidenceProvider',
    provenance: 'external_source',
    retrievedAt: T0,
    publishedAt: T0,
    title: 'Source',
    text: 'Background context. The mission carried 12 instruments. Some instruments failed later.',
    citations: [],
  };
  const r = matchingPassages('The mission carried 12 instruments.', [d]);
  assert.equal(r[0].passage, 'The mission carried 12 instruments.');
  assert.match(r[0].context, /Some instruments failed/);
  assert.equal(matchingPassages('Unrelated unsupported claim', [d]).length, 0);
});
test('three bars require reviewed independent direct agreement; shared origins, conflicting sources and imports block upgrades', () => {
  const claim = 'The mission carried 12 instruments.';
  const make = (url: string, group: string): SourceDocument => ({
    url,
    provider: 'PublicEvidenceProvider',
    provenance: 'external_source',
    retrievedAt: T0,
    publishedAt: T0,
    title: 'Source',
    text: claim,
    citations: [],
    comparisons: [{ claim, passage: claim, kind: 'factual' }],
    independenceReview: {
      group,
      rationale: 'Separate original reporting supported by this source record.',
      reviewedAt: T0,
      provenance: 'user_captured',
    },
  });
  const a = make('https://first.example/report', 'First organization'),
    b = make('https://second.example/report', 'Second organization');
  assert.equal(reviewedCorroboration(claim, [a, b]).eligible, true);
  const inv = upsertInvestigation(null, obs('a', null, { sources: [a, b] }));
  assert.equal(
    currentSnapshot(inv).findings.find((f) => f.title === 'Reviewed source agreement')!.strength!
      .bars,
    3,
  );
  assert.equal(reviewedCorroboration(claim, [a, { ...b, citations: [a.url] }]).eligible, false);
  assert.equal(
    reviewedCorroboration(claim, [a, { ...b, independenceReview: a.independenceReview }]).eligible,
    false,
  );
  assert.equal(
    reviewedCorroboration(claim, [a, { ...b, independenceReview: undefined }]).eligible,
    false,
  );
  const conflict = {
    ...b,
    text: 'The mission carried 10 instruments.',
    comparisons: [
      { claim, passage: 'The mission carried 10 instruments.', kind: 'factual' as const },
    ],
  };
  assert.equal(reviewedCorroboration(claim, [a, conflict]).eligible, false);
  const imported = new UserEvidenceProvider(obs('a', null, { sources: [a, b] })).observation;
  assert.equal(reviewedCorroboration(claim, imported.sources!).eligible, false);
});
test('Google candidates retain unknown dates and reject private image URLs before any provider call', async () => {
  const previous = process.env.GOOGLE_VISION_API_KEY;
  process.env.GOOGLE_VISION_API_KEY = 'unit-test-placeholder';
  let requests = 0;
  const api: any = async (url: string, _s: unknown, headers: any, body: string) => {
    requests++;
    assert.equal(url, 'https://vision.googleapis.com/v1/images:annotate');
    assert.equal(headers['X-Goog-Api-Key'], 'unit-test-placeholder');
    assert.equal(JSON.parse(body).requests.length, 1);
    return {
      responses: [
        {
          webDetection: {
            pagesWithMatchingImages: [
              {
                url: 'https://example.org/article',
                pageTitle: 'Matching candidate',
                fullMatchingImages: [{ url: 'https://example.org/image.jpg' }],
              },
            ],
          },
        },
      ],
    };
  };
  try {
    await assert.rejects(
      mediaSearch(
        { provider: 'google', imageUrl: 'https://127.0.0.1/private.jpg' },
        session(),
        api,
      ),
      /Non-public/,
    );
    assert.equal(requests, 0);
    const r = await mediaSearch(
      { provider: 'google', imageUrl: 'https://1.1.1.1/image.jpg' },
      session(),
      api,
    );
    assert.equal(requests, 1);
    assert.equal(r.instances[0].publishedAt, null);
    assert.equal(r.instances[0].match, 'full_image');
  } finally {
    if (previous) process.env.GOOGLE_VISION_API_KEY = previous;
    else delete process.env.GOOGLE_VISION_API_KEY;
  }
});
test('EXIF date extraction excludes artist, camera and GPS identifiers', async () => {
  const bytes = readFileSync('test/fixtures/media/synthetic-exif.jpg');
  const raw = await exifr.parse(bytes);
  assert.equal(typeof raw.latitude, 'number');
  const data = await dateMetadata(bytes as unknown as File);
  assert.equal(data.DateTimeOriginal, '2020:01:02 03:04:05');
  assert.equal(data.Artist, undefined);
  assert.equal(data.Make, undefined);
  assert.equal(data.latitude, undefined);
});
