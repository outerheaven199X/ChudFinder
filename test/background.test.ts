import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {obs,post,T0} from './helpers.ts';
import {currentSnapshot,validateSnapshot} from '../src/shared/engine.ts';
import {coverage} from '../src/shared/providers.ts';

test('built background preserves propagation query on edits and replaces a full sample on new search', async()=>{
  let listener:any;
  const store:any={providerSettings:{url:'http://127.0.0.1:18883',maxRequests:4}};
  const area={
    async get(keys:any){return Object.fromEntries((typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(store)).filter(k=>k in store).map(k=>[k,structuredClone(store[k])]));},
    async set(patch:any){Object.assign(store,structuredClone(patch));},
    async remove(){}
  };
  const chrome={runtime:{id:'a'.repeat(32),getURL:(p:string)=>'chrome-extension://'+'a'.repeat(32)+'/'+p,onMessage:{addListener:(fn:any)=>{listener=fn;}},onStartup:{addListener(){}},onInstalled:{addListener(){}}},storage:{local:area},permissions:{contains:async()=>false},alarms:{get:async()=>null,create(){},onAlarm:{addListener(){}}},sidePanel:{setPanelBehavior:async()=>{},open:async()=>{}},tabs:{create:async()=>{}}};
  const fetch=async(_url:any,init:any)=>{
    const request=JSON.parse(init.body);
    if(request.operation==='capabilities')return new Response(JSON.stringify({result:{x:false},telemetry:{requests:0}}));
    assert.equal(request.operation,'posts');
    const second=request.payload.text==='"second phrase"';
    const posts=Array.from({length:100},(_,i)=>post(String((second?2000:1000)+i),'author'+i,(second?'second phrase':'first phrase')+' with context '+i,T0));
    return new Response(JSON.stringify({result:{posts,coverage:coverage('XOfficialProvider',request.payload.text,100,[],'partial')},telemetry:{requests:1}}));
  };
  runInNewContext(readFileSync(process.env.CF_TEST_BACKGROUND || 'dist/src/background.js','utf8'),{chrome,fetch,URL,AbortSignal,AbortController,crypto,TextEncoder,console,setTimeout,clearTimeout,structuredClone});
  const message=(m:any)=>new Promise<any>((resolve,reject)=>listener(m,{id:chrome.runtime.id},(r:any)=>r?.ok?resolve(r):reject(new Error(r?.error))));
  const latest=()=>store['cf:inv:'+store['cf:activeInv']];
  const propagation=()=>{const inv=latest(),snap=currentSnapshot(inv);return inv.evidence.find((e:any)=>e.id===snap.displayRoles!['E-07'][0]);};
  await message({type:'investigate',observation:obs('target',null,{posts:[post('1','target','The original selected claim.',T0)],focusPostId:'1'})});
  await message({type:'search-propagation',handle:'target',query:'"first phrase"'});
  assert.equal(propagation().value.postIds.length,99);
  const oldSnapshot=JSON.stringify(currentSnapshot(latest()));
  await message({type:'capture-about',handle:'target',about:obs('target',{basedIn:'Germany'}).about});
  assert.equal(propagation().value.query,'"first phrase"');
  assert.equal(propagation().value.postIds.length,99);
  await message({type:'search-propagation',handle:'target',query:'"second phrase"'});
  const inv=latest(),snap=currentSnapshot(inv);
  assert.equal(snap.posts.length,100);
  assert.equal(snap.focusPostId,'1');
  assert.equal(propagation().value.postIds.length,99);
  assert(snap.posts.some(p=>p.id==='2000'));
  assert(!snap.posts.some(p=>p.id==='1000'));
  assert.equal(JSON.stringify(inv.snapshots.find((s:any)=>s.version===2)),oldSnapshot);
  validateSnapshot(snap,inv.evidence);
});
