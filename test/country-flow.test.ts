import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {JSDOM} from 'jsdom';
import {readAbout,aboutFailure} from '../src/ext/about-dom.ts';
import {cachedCountryBadge} from '../src/ext/country-badge.ts';
import {CountryLookup} from '../src/ext/country-lookup.ts';
import {currentSnapshot,investigationId,upsertInvestigation} from '../src/shared/engine.ts';
import {obs,T0} from './helpers.ts';

const captured=JSON.parse(readFileSync('test/fixtures/0xReso-about.json','utf8'));
const aboutHTML=captured.rows.map((r:any)=>r.html).join('');
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(check:()=>unknown,timeout=5000){const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw new Error('Timed out waiting for assertion state');await wait(10);}}
function storage(initial:any={}){
  const data:any=structuredClone(initial),listeners:Function[]=[];
  const area={
    async get(keys:any){return Object.fromEntries((typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(data)).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]));},
    async set(patch:any){const changes:any={};for(const [k,v]of Object.entries(patch)){const next=structuredClone(v);if(JSON.stringify(data[k])!==JSON.stringify(next))changes[k]={oldValue:data[k],newValue:next};data[k]=next;}for(const f of listeners)f(changes,'local');},
    async remove(keys:any){const changes:any={};for(const k of Array.isArray(keys)?keys:[keys]){changes[k]={oldValue:data[k]};delete data[k];}for(const f of listeners)f(changes,'local');}
  };
  return {data,area,listeners};
}

test('live 0xReso About markup preserves region, store region and the displayed accuracy warning',()=>{
  const dom=new JSDOM(aboutHTML+'<div role="dialog">'+captured.warning+'<button>OK</button></div>',{url:captured.url});
  const a=readAbout(dom.window.document,captured.url,captured.observedAt)!;
  assert.equal(a.basedIn,'South Asia');assert.equal(a.source,'South Asia App Store');assert.equal(a.accurate,false);
  assert.equal(a.provenance,'page_observed');assert.match(a.displayText!,/Country or region may not be accurate/);
  const badge=cachedCountryBadge({handle:'0xReso',about:a},'0xreso')!;
  assert.equal(badge.flag,'🌐');assert.equal(badge.warning,true);assert.match(badge.detail,/South Asia App Store/);
  assert.equal(cachedCountryBadge({handle:'other',about:a},'other'),null);
  const country=readAbout(new JSDOM(aboutHTML.replaceAll('South Asia','India')).window.document,captured.url)!;
  assert.equal(cachedCountryBadge({handle:'0xReso',about:country},'0xreso')!.flag,'🇮🇳');
  assert.equal(readAbout(new JSDOM('<span data-testid="UserLocation">New Delhi, India</span>').window.document,captured.url),null);
  dom.window.close();
});

test('lookup serializes tabs, deduplicates, caches, validates ownership, and obeys Auto/Careful and daily limits',async()=>{
  const s=storage({'cf:lookupV32':true,settings:{lookupMode:'careful'}}),session=storage();
  const created:any[]=[],closed:number[]=[],results:string[]=[];
  const chrome={storage:{local:s.area,session:session.area},tabs:{async create(t:any){const tab={...t,id:created.length+1};created.push(tab);return tab;},async sendMessage(){return{owned:true};},async remove(id:number){closed.push(id);}}};
  const lookup=new CountryLookup(chrome,async h=>{results.push(h);},1,500);
  await lookup.request('jack','auto');assert.equal(created.length,0);
  await Promise.all([lookup.request('jack','click'),lookup.request('jack','click')]);
  await until(()=>created.length===1);
  await lookup.request('next','auto');assert.equal(created.length,1);
  const job=created[0],nonce=new URL(job.url).hash.split('=')[1];
  const a=readAbout(new JSDOM(aboutHTML.replaceAll('South Asia','Germany')).window.document,'https://x.com/jack/about')!;
  assert.equal((await lookup.accept({nonce,about:a},{tab:{id:99},url:'https://x.com/jack/about'})).ok,false);
  assert.equal((await lookup.accept({nonce,about:a},{tab:{id:1},url:'https://x.com/other/about'})).ok,false);
  await lookup.accept({nonce,about:a},{tab:{id:1},url:job.url});
  await until(()=>closed.length===1);
  await lookup.request('jack','click');assert.equal(created.length,1);assert.deepEqual(results,['jack']);
  await s.area.set({settings:{lookupMode:'auto',dailyCap:50},'cf:countryPacing':{day:new Date().toLocaleDateString('en-CA'),count:50}});
  await lookup.request('limited','auto');await until(()=>s.data['cf:country:limited']?.status==='paused');assert.equal(created.length,1);
});

test('timeout and X sign-in are visible errors; a user-navigated worker tab is never closed',async()=>{
  const s=storage({'cf:lookupV32':true,settings:{lookupMode:'auto'}}),created:any[]=[],closed:number[]=[];
  const chrome={storage:{local:s.area},tabs:{async create(t:any){const tab={...t,id:created.length+1};created.push(tab);return tab;},async sendMessage(){return{owned:false};},async remove(id:number){closed.push(id);}}};
  const lookup=new CountryLookup(chrome,async()=>{},1,35);
  await lookup.request('timeout');await until(()=>s.data['cf:country:timeout']?.status==='error');
  assert.match(s.data['cf:country:timeout'].message,/did not load/);assert.equal(closed.length,0);
  const login=new JSDOM('<main>Sign in to X</main>');const message=aboutFailure(login.window.document)!;assert.match(message,/Sign in/);
  await lookup.request('needlogin');await until(()=>created.length===2);
  const job=created[1];await lookup.accept({nonce:new URL(job.url).hash.split('=')[1],error:message},{tab:{id:2},url:job.url});
  await until(()=>s.data['cf:countryPacing']?.pausedUntil>Date.now());
  await lookup.request('paused');await until(()=>s.data['cf:country:paused']?.status==='paused');assert.equal(created.length,2);
  login.window.close();
});

// Uses the actual built content, worker, background and panel scripts. Browser APIs
// are simulated; this does not assert installed-extension or live navigation acceptance.
test('empty cache -> automatic About worker -> badge -> immediate panel with profile/posts; Careful and live updates work',async t=>{
  const s=storage({settings:{enabled:true,lookupMode:'auto',showName:true,vpnWarnings:true},'cf:lookupV32':true,providerSettings:{url:'http://127.0.0.1:18883'}});
  const session=storage(),windows:any[]=[],workers=new Map<number,any>(),messages:any[]=[],opened:any[]=[],closed:number[]=[],created:any[]=[];
  let listener:any,fetches=0;
  const runtime={id:'a'.repeat(32),getURL:(p:string)=>'chrome-extension://'+'a'.repeat(32)+'/'+p,onMessage:{addListener:(fn:any)=>{listener=fn;}},onInstalled:{addListener(){}},onStartup:{addListener(){}}};
  const send=(m:any,sender:any)=>new Promise<any>(resolve=>{messages.push(m);listener(m,{id:runtime.id,...sender},resolve);});
  const background={runtime,storage:{local:s.area,session:session.area},permissions:{contains:async()=>false},alarms:{get:async()=>null,create(){},onAlarm:{addListener(){}}},sidePanel:{setPanelBehavior:async()=>{},open:async(p:any)=>{opened.push(p);}},tabs:{
    async create(args:any){const id=100+created.length;created.push({id,...args});assert.equal(args.active,false);const w=makeWindow(aboutHTML,args.url,id);workers.set(id,w);w.document.querySelector('[data-testid="pivot"]:nth-child(2)').addEventListener('click',()=>{const modal=w.document.createElement('div');modal.textContent=captured.warning;w.document.body.appendChild(modal);});return{id};},
    async sendMessage(id:number,m:any){return workers.get(id)?._receive(m);},
    async remove(id:number){closed.push(id);workers.get(id)?.close();workers.delete(id);}
  }};
  runInNewContext(readFileSync('dist/src/background.js','utf8'),{chrome:background,fetch:()=>{fetches++;throw new Error('Automatic flags and local click must not call paid providers');},URL,AbortSignal,AbortController,crypto,TextEncoder,console,setTimeout,clearTimeout,structuredClone});
  function makeWindow(html:string,url:string,id?:number,panel=false){
    const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true}),w:any=dom.window;windows.push(w);
    w.HTMLElement.prototype.getBoundingClientRect=()=>({top:20,bottom:40,left:0,right:120,width:120,height:20});
    w.chrome={storage:{local:s.area,onChanged:{addListener:(f:any)=>s.listeners.push(f)}},runtime:{...runtime,onMessage:{addListener:(fn:any)=>{w._receive=(m:any)=>new Promise(r=>fn(m,{},r));}},sendMessage:(m:any)=>panel&&m.type==='provider-capabilities'?new Promise(()=>{}):send(m,id==null?{}:{tab:{id},url:w.location.href})}};
    w.fetch=()=>{fetches++;throw new Error('No content or panel network');};
    w.eval(readFileSync(panel?'dist/src/sidepanel.js':'dist/src/content.js','utf8'));return w;
  }
  t.after(()=>windows.forEach(w=>w.close()));
  const panel=makeWindow(readFileSync('static/sidepanel.html','utf8'),runtime.getURL('src/sidepanel.html'),undefined,true);
  const page=makeWindow('<span data-testid="UserLocation">New Delhi, India</span><article data-testid="tweet"><div data-testid="User-Name"><a href="/0xReso">Reso</a></div><a href="/0xReso/status/2115756544428298642"><time datetime="2026-10-29T10:44:03Z"></time></a><div data-testid="tweetText" lang="en">A public post rendered on the profile.</div></article>','https://x.com/0xReso',10);
  await until(()=>created.length===1);assert.equal(page.document.querySelector('#cf-lookup-mode').value,'auto');
  // Click while acquisition is still loading. Visible profile/posts must save now.
  page.document.querySelector('#cf-profile-select').click();
  await until(()=>panel.document.querySelector('#main').textContent.includes('New Delhi, India'));
  assert.equal(opened.length,1);assert.equal(fetches,0);
  const invKey='cf:inv:'+investigationId('0xreso');
  assert.equal(currentSnapshot(s.data[invKey]).posts.length,1);
  await until(()=>s.data['cf:country:0xreso']?.status==='ready');
  await until(()=>page.document.querySelector('.cf-badge').textContent.includes('South Asia'));
  await until(()=>panel.document.querySelector('#main').textContent.includes('South Asia'));
  assert.match(page.document.querySelector('.cf-badge').textContent,/🌐 South Asia ⚠/);
  assert.equal(closed.length,1);assert.equal(created.length,1);assert.equal(fetches,0);
  const selector=page.document.querySelector('#cf-lookup-mode');selector.value='careful';selector.dispatchEvent(new page.Event('change'));
  await until(()=>s.data.settings.lookupMode==='careful');
  const block=page.document.createElement('div');block.dataset.testid='User-Name';block.innerHTML='<a href="/newaccount">New account</a>';page.document.body.appendChild(block);
  await until(()=>block.querySelector('.cf-badge'));await wait(80);assert.equal(created.length,1);assert.equal(block.querySelector('.cf-badge').textContent,'↗');
  block.dispatchEvent(new page.MouseEvent('mouseenter'));await until(()=>messages.some(m=>m.type==='lookup-country'&&m.handle==='newaccount'&&m.reason==='hover'));
  // Disable queued work before the six-second pacing delay elapses.
  await s.area.set({settings:{...s.data.settings,enabled:false}});
  const another=upsertInvestigation(null,obs('other',{basedIn:'Germany'}),T0);await s.area.set({['cf:inv:'+another.id]:another});
  await wait(60);assert.equal(s.data['cf:activeInv'],investigationId('0xreso'));
  assert(panel.document.querySelector('#main').textContent.includes('South Asia'));
  const snap=currentSnapshot(s.data[invKey]);assert(snap.evidenceIds.some(id=>s.data[invKey].evidence.find((e:any)=>e.id===id)?.provenance==='page_observed'));
  if(process.env.CF_FLOW_EVIDENCE_DIR){const dir=process.env.CF_FLOW_EVIDENCE_DIR;mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'built-flow-evidence.json'),JSON.stringify({scope:'Built scripts in JSDOM/VM; simulated Chrome APIs and tab navigation. About HTML captured from live X; profile/post input is a structural fixture. Not installed-browser acceptance.',at:new Date().toISOString(),fetchCalls:fetches,createdTabs:created,closedTabs:closed,panelOpens:opened,messages,investigation:s.data[invKey],country:s.data['cf:country:0xreso'],panelText:panel.document.querySelector('#main').textContent},null,2));}
});

test('panel does not miss an active investigation written while its initial storage read is pending',async t=>{
  const s=storage();let release:any,held=true;
  const initial=new Promise(resolve=>{release=resolve;});
  const store={...s.area,get:async(keys:any)=>held&&Array.isArray(keys)&&keys.includes('cf:activeInv')?initial:s.area.get(keys)};
  const dom=new JSDOM(readFileSync('static/sidepanel.html','utf8'),{url:'https://panel.test',runScripts:'outside-only'}),w:any=dom.window;t.after(()=>w.close());
  w.chrome={storage:{local:store,onChanged:{addListener:(f:any)=>s.listeners.push(f)}},runtime:{sendMessage:()=>new Promise(()=>{})}};
  w.eval(readFileSync('dist/src/sidepanel.js','utf8'));
  const inv=upsertInvestigation(null,obs('jack',{basedIn:'Germany'}),T0);
  await s.area.set({['cf:inv:'+inv.id]:inv,'cf:activeInv':inv.id});
  await until(()=>w.document.querySelector('#main').textContent.includes('Germany'));
  held=false;release({});await wait(40);
  assert(w.document.querySelector('#main').textContent.includes('Germany'));
});
