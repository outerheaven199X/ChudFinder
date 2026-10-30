import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import {upsertInvestigation,investigationId} from '../src/shared/engine.ts';
import {countryBadge} from '../src/ext/country-badge.ts';
import {obs,T0} from './helpers.ts';
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

test('country badges use current About evidence, never stale snapshots or self-described location', () => {
  const first=upsertInvestigation(null,obs('jack',{basedIn:'Germany',accurate:false}),T0);
  assert.equal(countryBadge(first,'JACK').flag,'🇩🇪');
  assert.equal(countryBadge(first,'jack').warning,true);
  assert.match(countryBadge(first,'jack').detail,/User-captured X display/);
  assert.match(countryBadge(first,'jack').detail,/2026-10-29/);
  assert.equal(countryBadge(first,'other').flag,'?');
  const removed=upsertInvestigation(first,obs('jack',null,{profileLocation:{text:'United States',observedAt:T0}}),T0);
  assert.equal(countryBadge(removed,'jack').flag,'?');
  const region=upsertInvestigation(null,obs('jack',{basedIn:'South Asia'}),T0);
  assert.equal(countryBadge(region,'jack').flag,'🌐');
  const forged=structuredClone(first);
  forged.evidence.find(e=>e.kind==='about_based_in')!.provenance='self_described';
  assert.equal(countryBadge(forged,'jack').flag,'?');
  assert.equal(countryBadge({bad:'record'},'jack').flag,'?');
});

test('built feed renders stored flags on load, updates quoted/recycled authors and opens investigation on one click', async () => {
  const dom=new JSDOM(fixture.TWEET_HTML,{url:'https://x.com/home',runScripts:'outside-only',pretendToBeVisual:true});
  const w:any=dom.window, messages:any[]=[], data:any={settings:{showName:true}};
  const jack=upsertInvestigation(null,obs('jack',{basedIn:'Germany'}),T0);
  data['cf:inv:'+jack.id]=jack;
  let changed:any;
  w.fetch=()=>{throw new Error('Badge rendering must not access the network');};
  w.chrome={storage:{local:{get:async(key:string)=>({[key]:data[key]})},onChanged:{addListener:(fn:any)=>{changed=fn;}}},runtime:{sendMessage:async(m:any)=>{messages.push(m);return {ok:true};},onMessage:{addListener(){}}}};
  w.eval(readFileSync('dist/src/content.js','utf8'));
  const settle=()=>new Promise(r=>setTimeout(r,70));
  await settle();
  const blocks=w.document.querySelectorAll('[data-testid="User-Name"]');
  assert.match(blocks[0].querySelector('.cf-badge').textContent,/🇩🇪 Germany/);
  assert.equal(blocks[1].querySelector('.cf-badge').textContent,'?');
  assert.equal(messages.length,0);
  blocks[0].querySelector('.cf-badge').click();
  await settle();
  assert.equal(messages.length,1);
  assert.equal(messages[0].observation.handle,'jack');
  assert.equal(messages[0].observation.posts[0].id,'20');
  const quote=upsertInvestigation(null,obs('quoted_person',{basedIn:'South Asia'}),T0);
  changed({['cf:inv:'+quote.id]:{newValue:quote}},'local');
  await settle();
  assert.match(blocks[1].querySelector('.cf-badge').textContent,/🌐 South Asia/);
  blocks[1].querySelector('.cf-badge').click();
  assert.equal(messages.at(-1).observation.handle,'quoted_person');
  assert.equal(messages.at(-1).observation.posts.length,0);
  // X recycles author containers during navigation and scrolling.
  for(const a of blocks[0].querySelectorAll('a[href="/jack"]'))a.setAttribute('href','/unknown');
  blocks[0].appendChild(w.document.createTextNode(' '));
  await settle();
  assert.equal(blocks[0].querySelectorAll('.cf-badge').length,1);
  assert.equal(blocks[0].querySelector('.cf-badge').textContent,'?');
  changed({['cf:inv:'+quote.id]:{oldValue:quote}},'local');
  await settle();
  assert.equal(blocks[1].querySelector('.cf-badge').textContent,'?');
  assert.equal(messages.length,2);
  w.close();
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
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'investigate');
  assert.equal(messages[0].observation.about, null);
  assert.ok(messages[0].observation.posts.length <= 1);
  assert.equal(requests, 0);
  w.close();
});
