import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  fixture = require('./legacy/fixtures.cjs');

test('release excludes page bridge and all authenticated acquisition primitives', () => {
  const m = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
  assert.ok(!existsSync('dist/src/page.js'));
  assert.ok(!m.content_scripts.some((c: any) => c.world === 'MAIN'));
  assert.deepEqual(m.host_permissions, []);
  assert.ok(!m.permissions.some((p: string) => ['cookies', 'webRequest', 'debugger'].includes(p)));
  for (const file of readdirSync('dist/src').filter(f => f.endsWith('.js'))) {
    const text = readFileSync('dist/src/' + file, 'utf8');
    assert.doesNotMatch(
      text,
      /document\.cookie|AboutAccountQuery|discoverQueryId|x-csrf-token|OAuth2Session|XMLHttpRequest\.prototype|\/i\/api\/graphql/,
    );
  }
});
test('built content only captures the selected post after explicit Investigate; no requests on scroll or hover', async () => {
  const dom = new JSDOM(fixture.TWEET_HTML, {
    url: 'https://x.com/home',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w: any = dom.window,
    messages: any[] = [];
  let requests = 0;
  w.fetch = async () => {
    requests++;
    throw new Error('No content network allowed');
  };
  w.chrome = {
    storage: {
      local: { get: async () => ({ settings: { lookupMode: 'auto' } }) },
      onChanged: { addListener() {} },
    },
    runtime: {
      sendMessage: async (m: any) => {
        messages.push(m);
        return { ok: true };
      },
      onMessage: { addListener() {} },
    },
  };
  w.eval(readFileSync('dist/src/content.js', 'utf8'));
  await new Promise((r) => setTimeout(r, 80));
  const badge = w.document.querySelector('.cf-badge');
  assert.ok(badge);
  badge.dispatchEvent(new w.MouseEvent('mouseenter'));
  w.dispatchEvent(new w.Event('scroll'));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(requests, 0);
  assert.equal(messages.length, 0);
  badge.click();
  await new Promise(r=>setTimeout(r,10));
  assert.match(w.document.querySelector('.cf-pop').textContent, /Unavailable/);
  const button = [...w.document.querySelectorAll('.cf-pop button')].find(
    (e: any) => e.textContent === 'Investigate',
  ) as any;
  assert.ok(button);
  button.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'investigate');
  assert.equal(messages[0].observation.about, null);
  assert.ok(messages[0].observation.posts.length <= 1);
  assert.equal(requests, 0);
  w.close();
});
