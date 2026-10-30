import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UserEvidenceProvider,
  XOfficialProvider,
  PublicEvidenceProvider,
  OptionalGrokProvider,
  coverage,
} from '../src/shared/providers.ts';
import {
  publicAddress,
  publicRequest,
  xOperation,
  session,
  startServer,
  sourcePublicationDate,
} from '../server/adapter.ts';
import { JSDOM } from 'jsdom';
import { differenceHash } from '../src/ext/media.ts';
import { obs, post, T0 } from './helpers.ts';

test('source publication date recognizes NASA metadata without substituting last-updated time', () => {
  const document = new JSDOM('<meta property="og:updated_time" content="2026-10-29T11:10:20-04:00"><meta name="parsely-pub-date" content="2026-10-29T15:10:18Z">').window.document;
  assert.equal(sourcePublicationDate(document), '2026-10-29T15:10:18.000Z');
  document.querySelector('[name="parsely-pub-date"]')!.remove();
  assert.equal(sourcePublicationDate(document), null);
});

test('user import cannot impersonate official provenance', async () => {
  const raw = obs(
    'target',
    { basedIn: 'Canada', provenance: 'platform_reported' },
    {
      provider: 'XOfficialProvider',
      posts: [post('1', 'target', 'A supplied statement', T0, { capturedFrom: 'x_official' })],
    },
  );
  const provider = new UserEvidenceProvider(raw),
    result = await provider.getAccount('target');
  assert.equal(result.observation!.about!.provenance, 'user_captured');
  assert.equal(result.observation!.posts[0].capturedFrom, 'user_evidence');
  await assert.rejects(provider.getAccount('someone'), /mismatch/);
  assert.equal(provider.capabilities().historicalSearch, false);
});
test('official provider rejects malformed API shapes and propagates auth, rate and outage errors without retries', async () => {
  for (const message of [
    '401 expired authentication',
    '403 unauthorized',
    '429 rate limited',
    '503 provider outage',
  ]) {
    let calls = 0;
    const p = new XOfficialProvider(async () => {
      calls++;
      throw new Error(message);
    });
    await assert.rejects(p.getPost('1'), new RegExp(message));
    assert.equal(calls, 1);
  }
  const malformed = new XOfficialProvider(async () => ({
    posts: [{ id: '1' }],
    coverage: coverage('test', 'query'),
  }));
  await assert.rejects(malformed.getPosts({ handle: 'target' }));
});
test('unconfigured X is unavailable with explicit coverage, without fabricated metadata', async () => {
  const old = process.env.X_API_BEARER_TOKEN;
  delete process.env.X_API_BEARER_TOKEN;
  try {
    const s = session(),
      r = await xOperation('account', { handle: 'NASA' }, s);
    assert.equal(r.coverage.status, 'unavailable');
    assert.equal((r as any).observation, null);
    assert.equal(s.requests, 0);
  } finally {
    if (old) process.env.X_API_BEARER_TOKEN = old;
  }
});
test('source provider validates URLs, timestamps and response schemas', async () => {
  const p = new PublicEvidenceProvider(async () => ({
    sources: [{ url: 'javascript:alert(1)' }],
    coverage: coverage('public', 'query'),
  }));
  await assert.rejects(p.searchClaims({ text: 'question' }));
});
test('Grok questions with forged evidence refs are discarded and do not become facts', async () => {
  const p = new OptionalGrokProvider(async () => ({
    suggestions: [
      { question: 'What is missing?', evidenceIds: ['ev_real'] },
      { question: 'Unsupported?', evidenceIds: ['ev_fake'] },
    ],
    tokens: 25,
  }));
  const r = await p.enrich([{ id: 'ev_real', summary: 'An observation' }]);
  assert.equal(r.suggestions.length, 1);
  assert.equal(p.capabilities().posts, false);
});
test('SSRF rejects private, metadata, reserved addresses, credentials, ports and non-approved hosts', async () => {
  for (const ip of [
    '127.0.0.1',
    '169.254.169.254',
    '10.1.2.3',
    '172.16.2.3',
    '192.168.1.1',
    '100.64.1.1',
    '::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
    '192.0.2.1',
    '198.51.100.1',
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('192.0.66.108'), true, 'NASA public address is allowed');
  assert.equal(publicAddress('2606:4700::1111'), true);
  for (const url of [
    'http://www.nasa.gov/',
    'https://user:pass@www.nasa.gov/',
    'https://www.nasa.gov:444/',
    'https://127.0.0.1/',
    'https://unconfigured.example/',
  ])
    await assert.rejects(publicRequest(url), /not approved/);
});
test('loopback service refuses web origins and DNS-rebinding host headers', async () => {
  process.env.CF_EXTENSION_ORIGINS = 'chrome-extension://' + 'a'.repeat(32);
  const server = startServer(18877);
  await new Promise<void>((r) => server.once('listening', r));
  try {
    const base = 'http://127.0.0.1:18877/provider';
    const evil = await fetch(base, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(evil.status, 403);
    const good = await fetch(base, {
      method: 'POST',
      headers: {
        Origin: 'chrome-extension://' + 'a'.repeat(32),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operation: 'capabilities', payload: {} }),
    });
    assert.equal(good.status, 200);
    const body = (await good.json()) as any;
    assert.equal(typeof body.result.x, 'boolean');
    assert.ok(!JSON.stringify(body).includes('API_KEY'));
    const bad = await fetch(base, {
      method: 'POST',
      headers: {
        Origin: 'chrome-extension://' + 'a'.repeat(32),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operation: 'arbitrary-fetch',
        payload: { url: 'https://evil.example' },
      }),
    });
    assert.equal(bad.status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    delete process.env.CF_EXTENSION_ORIGINS;
  }
});
test('pixel fingerprint is deterministic and rejects the wrong geometry', () => {
  const pixels = new Uint8ClampedArray(9 * 8 * 4);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 9; x++)
      for (let c = 0; c < 3; c++) pixels[(y * 9 + x) * 4 + c] = 255 - x * 20;
  assert.equal(differenceHash(pixels), 'ffffffffffffffff');
  assert.throws(() => differenceHash(new Uint8ClampedArray(4)));
});
import { requestJson } from '../server/adapter.ts';
import { saveInvestigation, INDEX_KEY } from '../src/ext/store.ts';
import { upsertInvestigation } from '../src/shared/engine.ts';

test('official response maps actual fields, preserves partial coverage and never substitutes profile location for Based in', async () => {
  const old = process.env.X_API_BEARER_TOKEN;
  process.env.X_API_BEARER_TOKEN = 'test-only-not-a-real-credential';
  try {
    const calls: string[] = [];
    const api = async (url: string) => {
      calls.push(url);
      if (url.includes('/users/by/username/'))
        return { data: { id: '123', username: 'NASA', location: 'Earth' } };
      return {
        data: [
          {
            id: '1234',
            author_id: '123',
            text: 'A timestamped public observation.',
            created_at: T0,
            lang: 'en',
            entities: { urls: [{ expanded_url: 'https://www.nasa.gov/' }] },
            public_metrics: { retweet_count: 3 },
            referenced_tweets: [{ type: 'quoted', id: '12' }],
          },
        ],
        includes: {
          users: [
            {
              id: '123',
              username: 'NASA',
              created_at: '2007-12-19T00:00:00.000Z',
              public_metrics: { followers_count: 12000 },
            },
          ],
        },
        meta: { next_token: 'page2' },
        errors: [{ detail: 'one expansion unavailable' }],
      };
    };
    const a = await xOperation('account', { handle: 'NASA' }, session(), api as any);
    assert.equal((a as any).observation.about, null);
    assert.equal((a as any).observation.profileLocation.text, 'Earth');
    const r = (await xOperation(
      'posts',
      { text: '"public observation"', limit: 10 },
      session(),
      api as any,
    )) as any;
    assert.equal(r.posts.length, 1);
    assert.equal(r.posts[0].quotedPostId, '12');
    assert.equal(r.posts[0].authorCreatedAt, '2007-12-19T00:00:00.000Z');
    assert.equal(r.coverage.nextCursor, 'page2');
    assert.equal(r.coverage.complete, false);
    assert.equal(r.coverage.status, 'partial');
    assert.ok(calls.every((u) => u.startsWith('https://api.x.com/2/')));
  } finally {
    if (old) process.env.X_API_BEARER_TOKEN = old;
    else delete process.env.X_API_BEARER_TOKEN;
  }
});
test('request budgets, cancellation, caching and bounded retries are enforced before network work', async () => {
  const response = (status: number, text = '{}') => ({
    status,
    text,
    url: 'https://api.x.com/test',
    headers: {},
  });
  let calls = 0;
  const retry = async () => {
    calls++;
    return response(503);
  };
  const a = session(2);
  await assert.rejects(requestJson('https://api.x.com/retry-test', a, {}, undefined, retry), /503/);
  assert.equal(calls, 2);
  assert.equal(a.failures, 2);
  const b = session(1);
  calls = 0;
  await assert.rejects(
    requestJson('https://api.x.com/budget-test', b, {}, undefined, retry),
    /budget/,
  );
  assert.equal(calls, 1);
  for (const status of [401, 403, 429]) {
    calls = 0;
    await assert.rejects(
      requestJson('https://api.x.com/status-' + status, session(), {}, undefined, async () => {
        calls++;
        return response(status);
      }),
      new RegExp(String(status)),
    );
    assert.equal(calls, 1);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    requestJson('https://api.x.com/cancelled', session(8, controller.signal), {}, undefined, retry),
    /Cancelled/,
  );
  const c = session();
  calls = 0;
  const cached = async () => {
    calls++;
    return response(200, '{"data":1}');
  };
  await requestJson('https://api.x.com/cache-test', c, {}, undefined, cached);
  await requestJson('https://api.x.com/cache-test', c, {}, undefined, cached);
  assert.equal(calls, 1);
  assert.equal(c.cacheHits, 1);
});

test('official provider requests long-post text and preserves its links with explicit size limits', async () => {
  const old = process.env.X_API_BEARER_TOKEN;
  process.env.X_API_BEARER_TOKEN = 'test-only-not-a-real-credential';
  try {
    const api = async (url: string) => {
      assert.ok(new URL(url).searchParams.get('tweet.fields')!.split(',').includes('note_tweet'));
      return {
        data: [{ id: '100', author_id: '9', text: 'Truncated intro', created_at: T0,
          note_tweet: { text: 'Dragonfly mission ' + 'bounded '.repeat(600),
            entities: { urls: [{ expanded_url: 'https://www.nasa.gov/long-post-source' }] } } }],
        includes: {users: [{id:'9', username:'NASA'}]},
      };
    };
    const result = await xOperation('posts', {text:'"Dragonfly mission"', limit:10}, session(), api as any) as any;
    assert.ok(result.posts[0].text.startsWith('Dragonfly mission'));
    assert.equal(result.posts[0].text.length, 4000);
    assert.deepEqual(result.posts[0].links, ['https://www.nasa.gov/long-post-source']);
    assert.equal(result.coverage.status, 'partial');
    assert.ok(result.coverage.limitations.some((s: string) => s.includes('4,000')));
  } finally {
    if (old) process.env.X_API_BEARER_TOKEN = old;
    else delete process.env.X_API_BEARER_TOKEN;
  }
});
test('concurrent investigation saves retain both index entries', async () => {
  const data: Record<string, any> = {};
  const area = {
    get: async (k: any) => {
      await new Promise((r) => setTimeout(r, 3));
      return { [k]: structuredClone(data[k]) };
    },
    set: async (o: any) => {
      Object.assign(data, structuredClone(o));
    },
    remove: async () => {},
  };
  await Promise.all([
    saveInvestigation(area, upsertInvestigation(null, obs('a', null))),
    saveInvestigation(area, upsertInvestigation(null, obs('b', null))),
  ]);
  assert.equal(data[INDEX_KEY].length, 2);
});
