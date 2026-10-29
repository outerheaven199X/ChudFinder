import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { extractPost, parseRoute, postsOnPage, ADAPTER_VERSION } from '../src/ext/xdom.ts';

const F = createRequire(import.meta.url)('./legacy/fixtures.cjs');

test('DOM adapter: main post, quoted author, time, text (quoted text excluded)', () => {
  const d = new JSDOM(F.TWEET_HTML, { url: 'https://x.com/home' }).window.document;
  const p = extractPost(d.querySelector('article')!)!;
  assert.equal(p.id, '20'); assert.equal(p.handle, 'jack');
  assert.equal(p.text, 'just setting up my twttr');
  assert.equal(p.createdAt, '2006-03-21T20:50:14.000Z');
  assert.equal(p.quotedHandle, 'quoted_person');
  assert.equal(p.url, 'https://x.com/jack/status/20');
  assert.match(ADAPTER_VERSION, /^x-dom@/);
});

test('DOM adapter: links are https only, lang tag, reply target', () => {
  const html = `<article data-testid="tweet"><div data-testid="User-Name"><a href="/alice">Alice</a></div>
    <div><div>Replying to <a href="/bob">@bob</a></div></div>
    <a href="/alice/status/99"><time datetime="2026-10-28T12:00:00.000Z">x</time></a>
    <div data-testid="tweetText" lang="pt"><span>Veja</span> <a href="https://t.co/abc">https://example.com/report…</a>
    <a href="javascript:alert(1)">javascript:alert(1)</a> <a href="/hashtag/x">#x</a></div></article>`;
  const d = new JSDOM(html, { url: 'https://x.com/alice/status/99' }).window.document;
  const p = extractPost(d.querySelector('article')!)!;
  assert.deepEqual(p.links, ['https://example.com/report']);
  assert.equal(p.lang, 'pt'); assert.equal(p.replyToHandle, 'bob');
  assert.equal(postsOnPage(d, 'alice').length, 1); assert.equal(postsOnPage(d, 'carol').length, 0);
});

test('SPA routes', () => {
  assert.deepEqual(parseRoute('https://x.com/home'), { kind: 'home', handle: null, statusId: null });
  assert.deepEqual(parseRoute('https://x.com/vllm_project'), { kind: 'profile', handle: 'vllm_project', statusId: null });
  assert.deepEqual(parseRoute('https://x.com/vllm_project/with_replies'), { kind: 'profile', handle: 'vllm_project', statusId: null });
  assert.deepEqual(parseRoute('https://x.com/jack/status/20?s=1'), { kind: 'status', handle: 'jack', statusId: '20' });
  assert.equal(parseRoute('https://x.com/explore').kind, 'other');
  assert.equal(parseRoute('https://x.com/search?q=a').kind, 'search');
});
