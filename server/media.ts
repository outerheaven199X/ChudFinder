import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MediaVerification, MediaInstance } from '../src/shared/schemas.ts';
import { cleanText, safeHttpsUrl } from '../src/shared/sanitize.ts';
import { coverage } from '../src/shared/providers.ts';
import { publicAddress, type Session, type requestJson } from './adapter.ts';
import { lookup } from 'node:dns/promises';

export const MEDIA_LIMIT = 16_000_000;
export async function verifyMedia(payload: unknown, signal?: AbortSignal) {
  const q = z
    .object({
      data: z
        .string()
        .max(Math.ceil(MEDIA_LIMIT / 3) * 4)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      mimeType: z.enum([
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/avif',
        'video/mp4',
        'video/quicktime',
      ]),
    })
    .strict()
    .parse(payload);
  const bytes = Buffer.from(q.data, 'base64');
  if (!bytes.length || bytes.length > MEDIA_LIMIT)
    throw new Error('Choose media under 16 MB for local verification');
  if (signal?.aborted) throw new Error('Cancelled');
  const result: any = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./provenance-worker.mjs', import.meta.url), {
      workerData: { bytes, mimeType: q.mimeType },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    const done = (error: Error | null, data?: unknown) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      void worker.terminate();
      error ? reject(error) : resolve(data);
    };
    const cancel = () => done(new Error('Cancelled'));
    const timer = setTimeout(() => done(new Error('Local C2PA verification timed out')), 15000);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.once('message', (data) => done(null, data));
    worker.once('error', (error) => done(error as Error));
    worker.once('exit', (code) => {
      if (code !== 0) done(new Error('Local verifier stopped'));
    });
  });
  const active = result.results?.activeManifest || {};
  const success = (active.success || []).map((s: any) => s.code),
    failure = (active.failure || []).map((s: any) => s.code);
  const codes = [
    ...new Set<string>([
      ...success,
      ...failure,
      ...(active.informational || []).map((s: any) => s.code),
      ...(result.status || []).map((s: any) => s.code),
    ]),
  ]
    .filter((s) => typeof s === 'string')
    .slice(0, 100);
  const mismatch = codes.some((c) => /Hash\.mismatch|hashedURI\.mismatch/.test(c));
  const invalid = codes.some((c) =>
    /claimSignature\.(mismatch|invalid)|signingCredential\.(expired|revoked)/.test(c),
  );
  return MediaVerification.parse({
    provider: 'LocalC2PA',
    checkedAt: new Date().toISOString(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    signature: result.absent
      ? 'absent'
      : invalid
        ? 'invalid'
        : success.includes('claimSignature.validated')
          ? 'validated'
          : 'unverified',
    binding: mismatch
      ? 'mismatch'
      : success.some((c: string) => /^assertion\.(dataHash|bmffHash|boxesHash)\.match$/.test(c))
        ? 'matched'
        : 'unverified',
    trust: codes.includes('signingCredential.untrusted')
      ? 'untrusted'
      : success.includes('signingCredential.trusted')
        ? 'trusted'
        : 'unverified',
    sdkState: cleanText(
      result.state || (result.absent ? 'No embedded manifest' : 'Unavailable'),
      80,
    ),
    codes,
    issuer: result.signature?.issuer ? cleanText(result.signature.issuer, 200) : null,
    signedAt: z.iso.datetime({ offset: true }).safeParse(result.signature?.time).success
      ? result.signature.time
      : null,
    limitations: [
      'Signature validation describes this supplied file, not the truth of the depicted event or the ownership of its URL.',
      'Offline verification: remote manifests and OCSP network fetching are disabled. Trust is the SDK result; no custom trust anchors are configured.',
      ...(result.error ? ['Parser result: ' + cleanText(result.error, 400)] : []),
      ...(result.absent
        ? ['No embedded manifest found. Absence does not establish authenticity or fabrication.']
        : []),
    ],
  });
}

export async function mediaSearch(payload: unknown, s: Session, api: typeof requestJson) {
  const q = z
    .object({
      sha1: z
        .string()
        .regex(/^[0-9a-f]{40}$/)
        .optional(),
      imageUrl: z.string().url().optional(),
      provider: z.enum(['commons', 'google']),
    })
    .strict()
    .parse(payload);
  const c = coverage(
      q.provider === 'commons' ? 'WikimediaCommons' : 'GoogleVisionWebDetection',
      q.sha1 || q.imageUrl || '',
    ),
    instances: MediaInstance[] = [];
  if (q.provider === 'commons') {
    if (!q.sha1) throw new Error('Exact-byte lookup requires a SHA-1 fingerprint');
    const data = await api(
      'https://commons.wikimedia.org/w/api.php?action=query&format=json&list=allimages&aisha1=' +
        q.sha1 +
        '&aiprop=timestamp%7Curl%7Csha1&ailimit=20',
      s,
    );
    if (data.error) throw new Error('Commons API: ' + cleanText(data.error.code, 100));
    if (!Array.isArray(data.query?.allimages)) throw new Error('Malformed Commons response');
    for (const i of data.query.allimages) {
      if (i.sha1 !== q.sha1) throw new Error('Commons returned a different file hash');
      instances.push(
        MediaInstance.parse({
          sourceUrl: i.descriptionurl,
          imageUrl: i.url,
          title: cleanText(i.name, 300),
          publishedAt: z.iso.datetime({ offset: true }).safeParse(i.timestamp).success
            ? i.timestamp
            : null,
          dateBasis: i.timestamp ? 'repository_upload' : 'unavailable',
          match: 'exact_sha1',
          provider: c.provider,
          retrievedAt: c.retrievedAt,
        }),
      );
    }
    c.nextCursor = data.continue ? JSON.stringify(data.continue) : null;
    c.limitations.push(
      'Exact file bytes in Wikimedia Commons only. Upload time is not event time or proof of the first publication. Re-encoded or edited copies are not found by this lookup.',
    );
  } else {
    if (!process.env.GOOGLE_VISION_API_KEY)
      return {
        instances,
        coverage: {
          ...c,
          status: 'unavailable',
          limitations: ['Google Vision is not configured; no web-image request made.'],
        },
      };
    const url = safeHttpsUrl(q.imageUrl);
    if (!url) throw new Error('A public HTTPS image URL is required');
    const u = new URL(url);
    if (u.port && u.port !== '443')
      throw new Error('Public image URL must use the HTTPS default port');
    const addresses = await lookup(u.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error('Non-public image URL');
    const data = await api(
      'https://vision.googleapis.com/v1/images:annotate',
      s,
      { 'X-Goog-Api-Key': process.env.GOOGLE_VISION_API_KEY, 'Content-Type': 'application/json' },
      JSON.stringify({
        requests: [
          {
            image: { source: { imageUri: url } },
            features: [{ type: 'WEB_DETECTION', maxResults: 20 }],
          },
        ],
      }),
    );
    const result = data.responses?.[0];
    if (!result || result.error) throw new Error('Google Vision unavailable or rejected the image');
    const w = result.webDetection || {};
    for (const page of (w.pagesWithMatchingImages || []).slice(0, 20)) {
      if (!safeHttpsUrl(page.url)) continue;
      instances.push(
        MediaInstance.parse({
          sourceUrl: page.url,
          imageUrl: safeHttpsUrl(
            page.fullMatchingImages?.[0]?.url || page.partialMatchingImages?.[0]?.url,
          ),
          title: cleanText(page.pageTitle || page.url, 300),
          publishedAt: null,
          dateBasis: 'unavailable',
          match: page.fullMatchingImages?.length ? 'full_image' : 'partial_image',
          provider: c.provider,
          retrievedAt: c.retrievedAt,
        }),
      );
    }
    c.limitations.push(
      'Provider image-match candidates only. This API supplies no defensible publication dates; retrieve the original sources to establish chronology. One explicit potentially paid request.',
    );
  }
  c.recordsExamined = instances.length;
  c.fields = ['matchingInstances', 'sourceUrls', 'datesWhenAvailable'];
  return { instances, coverage: c };
}
