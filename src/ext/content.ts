/* Rendered X display acquisition. No auth-token extraction or internal API requests. */
import { extractPost, handleFromUserName, parseRoute, postsOnPage, SEL, ADAPTER_VERSION } from './xdom.ts';
import { DEFAULT_SETTINGS } from './lib.ts';
import { cachedCountryBadge, countryBadge } from './country-badge.ts';
import { AccountObservation } from '../shared/schemas.ts';
import { cleanText } from '../shared/sanitize.ts';
import { investigationId } from '../shared/engine.ts';
import { readAbout, aboutFailure, locationWarning, workerToken } from './about-dom.ts';
import { COUNTRY_PREFIX } from './country-lookup.ts';
import type { CountryRecord } from './country-lookup.ts';
import { mountLookupHelp } from './lookup-help.ts';
import { readLookupSettings, setLookupMode, PASSIVE_MIGRATION, BACKGROUND_OPT_IN } from './lookup-settings.ts';
declare const chrome:any;
const version=chrome.runtime.getManifest?.().version || '3.3.0';
const instanceKey='__cfContent_'+(chrome.runtime.id || 'test');
const restartEvent='cf-content-restart-'+(chrome.runtime.id || 'test');
const instances=globalThis as any;
if(instances[instanceKey]?.version!==version || !instances[instanceKey]?.active()){
  instances[instanceKey]?.stop();
  document.dispatchEvent(new Event(restartEvent));
  instances[instanceKey]=startContent();
}
function startContent(){
let alive=true,observer:MutationObserver|undefined,workerTimer:ReturnType<typeof setInterval>|undefined,workerDeadline:ReturnType<typeof setTimeout>|undefined;
const events=new AbortController();
document.documentElement.dataset.cfContentVersion=version;
let settings={...DEFAULT_SETTINGS,lookupMode:'careful' as 'auto'|'careful'},settingsGeneration=0;
const mounted=new WeakMap<Element,{handle:string;button:HTMLButtonElement}>();
const badges=new Map<string,ReturnType<typeof countryBadge>>(),records=new Map<string,CountryRecord>();
const pending=new Set<string>(),requests=new Map<string,number>();
let scheduled=false,lastAbout='',workerDone=false;
const nonce=workerToken(location.href);
function toast(message:string){
  let e=document.getElementById('cf-message');
  if(!e){e=document.createElement('div');e.id='cf-message';e.setAttribute('role','alert');e.style.cssText='position:fixed;bottom:76px;right:18px;z-index:2147483646;background:#151515;color:#fff;padding:14px;max-width:400px;border:1px solid #ffae52;font:14px system-ui';document.body.appendChild(e);}
  e.textContent=message;
}
async function request(handle:string,reason:string){
  if(!alive||settings.lookupMode!=='auto')return;
  const h=handle.toLowerCase(),r=records.get(h);
  if(reason==='auto' && (settings.lookupMode!=='auto'||document.visibilityState==='hidden'))return;
  if(r?.status==='ready'&&r.expiresAt>Date.now())return;
  if(Date.now()-(requests.get(h)||0)<(reason==='auto'?30000:1500))return;
  requests.set(h,Date.now());
  try{const result=await chrome.runtime.sendMessage({type:'lookup-country',handle:h,reason});if(!result?.ok)throw new Error(result?.error || 'Country lookup did not respond');}
  catch(e:any){if(reason!=='auto')toast('Chud Finder: '+e.message+'. Reload this X tab after updating the extension.');}
}
function loadBadge(handle:string){
  const h=handle.toLowerCase();if(badges.has(h)||pending.has(h))return;pending.add(h);
  const key='cf:inv:'+investigationId(h);
  chrome.storage.local.get([key,COUNTRY_PREFIX+h]).then(g=>{
    if(!alive)return;
    badges.set(h,countryBadge(g[key],h));if(g[COUNTRY_PREFIX+h])records.set(h,g[COUNTRY_PREFIX+h]);
  }).catch(()=>badges.set(h,countryBadge(null,h))).finally(()=>{pending.delete(h);schedule();});
}
function paint(button:HTMLButtonElement,handle:string,profile=false){
  const h=handle.toLowerCase(),r=records.get(h),value=cachedCountryBadge(r,h)||badges.get(h)||countryBadge(null,h),state=r?.status;
  const symbol=value.name?value.flag:settings.lookupMode==='careful'?'?':state==='queued'||state==='loading'?'…':state==='error'?'!':state==='paused'?'Ⅱ':!r?'…':'?';
  const label=symbol+(value.name&&settings.showName?' '+value.name:'')+(value.warning&&settings.vpnWarnings?' ⚠':'')+(profile?' / @'+handle:'');
  const detail=value.name?value.detail:(settings.lookupMode==='careful'?'Country not captured yet. Open About ↗ once to save what X displays.':r?.message||'Country lookup will start when this account is visible.')+' Click to investigate @'+handle+'.';
  const signature=JSON.stringify([label,detail]);if(button.dataset.cfDisplay===signature)return;
  button.dataset.cfDisplay=signature;button.className='cf-badge cf-ask'+(value.name?'':' cf-unknown');button.textContent=label;button.title=detail;
  button.setAttribute('aria-label','Investigate @'+handle+': '+(value.name||detail));
}
function aboutLink(button:HTMLButtonElement,handle:string){
  const h=handle.toLowerCase(),known=(cachedCountryBadge(records.get(h),h)||badges.get(h))?.name;
  let a=button.nextElementSibling as HTMLAnchorElement|null;
  if(!a?.classList.contains('cf-about-link'))a=null;
  if(settings.lookupMode!=='careful'||known){a?.remove();return;}
  if(!a){a=document.createElement('a');a.className='cf-about-link';a.target='_blank';a.rel='noopener noreferrer';a.textContent='About ↗';
    a.style.cssText='display:inline-block;margin-left:5px;color:inherit;font:12px system-ui;text-decoration:underline;white-space:nowrap';
    // A normal link activated by the user, never a scripted/background navigation.
    a.addEventListener('click',e=>e.stopPropagation(),{signal:events.signal});button.after(a);}
  if(a.dataset.cfHandle===handle)return;a.dataset.cfHandle=handle;
  a.href='https://x.com/'+encodeURIComponent(handle)+'/about';
  a.title='Open @'+handle+'’s X About page. Chud Finder saves the displayed country automatically.';
  a.setAttribute('aria-label','Open X About for @'+handle+' and capture its displayed country');
}
function observation(handle:string,article:Element|null){
  const now=new Date().toISOString(),route=parseRoute(location.href),onProfile=route.handle?.toLowerCase()===handle.toLowerCase();
  const candidate=article?extractPost(article):null,post=candidate?.handle.toLowerCase()===handle.toLowerCase()?candidate:null;
  const profile=onProfile?document.querySelector('[data-testid="UserLocation"]')?.textContent:null;
  return AccountObservation.parse({handle,observedAt:now,pageUrl:location.href.split('#')[0],adapterVersion:ADAPTER_VERSION,
    about:onProfile?readAbout(document,location.href):null,profileLocation:profile?{text:cleanText(profile,120),observedAt:now}:null,
    posts:post?[post]:onProfile?postsOnPage(document,handle,50):[],focusPostId:post?.id||null,provider:'UserEvidenceProvider'});
}
function select(handle:string,article:Element|null){
  if(!alive)return;
  try{const obs=observation(handle,article);
    chrome.runtime.sendMessage({type:'investigate',observation:obs,localOnly:true}).then(r=>{if(!r?.ok)throw new Error(r?.error||'Investigation did not respond');})
      .catch(e=>toast('Could not open investigation: '+e.message+'. Reload X if you just updated Chud Finder.'));
  }catch(e:any){toast('Cannot read this account: '+e.message);}
}
function bind(button:HTMLButtonElement,handle:string,article:Element|null){
  button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();select(handle,article);},{signal:events.signal});
  let timer:ReturnType<typeof setTimeout>|undefined;
  button.addEventListener('mouseenter',()=>{timer=setTimeout(()=>void request(handle,'hover'),450);},{signal:events.signal});
  button.addEventListener('mouseleave',()=>{if(timer)clearTimeout(timer);},{signal:events.signal});
  button.addEventListener('focus',()=>void request(handle,'hover'),{signal:events.signal});
}
function visible(e:Element){const r=e.getBoundingClientRect();return r.height>0&&r.bottom>0&&r.top<innerHeight;}
function controls(){
  let root=document.getElementById('cf-mode-control');
  if(!root){root=document.createElement('div');root.id='cf-mode-control';root.style.cssText='position:fixed;left:16px;bottom:16px;z-index:1000;display:flex;align-items:center;gap:8px;background:#101014;color:#fff;padding:7px;border:1px solid #888;font:12px system-ui';
    const label=document.createElement('label');label.textContent='Chud Finder ';const mode=document.createElement('select');mode.id='cf-lookup-mode';mode.setAttribute('aria-label','Chud Finder lookup mode');
    for(const [v,t]of [['auto','Auto'],['careful','Careful']]){const o=document.createElement('option');o.value=v;o.textContent=t;mode.appendChild(o);}
    mode.addEventListener('change',()=>void setLookupMode(chrome,mode.value));
    label.appendChild(mode);root.appendChild(label);mountLookupHelp(root,true,events.signal);document.body.appendChild(root);
  }
  const mode=root.querySelector('select')!;if(mode.value!==settings.lookupMode)mode.value=settings.lookupMode;
}
function captureOpenAbout(){
  const about=readAbout(document,location.href),handle=parseRoute(location.href).handle;if(!about||!handle)return;
  const prior=records.get(handle.toLowerCase())?.about;
  const warningRow=[...document.querySelectorAll('[data-testid="pivot"]')].find(e=>e.textContent?.startsWith('Account based in'));
  if(about.accurate===null&&prior?.accurate===false&&prior.basedIn===about.basedIn&&prior.source===about.source&&warningRow&&warningRow.querySelectorAll('svg').length>1){about.accurate=false;about.displayText=prior.displayText;}
  const signature=JSON.stringify([handle,about.basedIn,about.source,about.accurate,about.displayText]);if(lastAbout===signature)return;lastAbout=signature;
  chrome.runtime.sendMessage({type:'about-observed',handle,about}).then(r=>{if(!r?.ok)lastAbout='';}).catch(()=>{lastAbout='';});
}
function scan(){
  if(!alive||!settings.enabled)return;controls();captureOpenAbout();
  for(const block of document.querySelectorAll(SEL.userName)){
    const handle=handleFromUserName(block);if(!handle)continue;loadBadge(handle);const old=mounted.get(block);
    if(old?.handle===handle&&old.button.isConnected)paint(old.button,handle);
    else{if(old?.button.nextElementSibling?.classList.contains('cf-about-link'))old.button.nextElementSibling.remove();old?.button.remove();const b=document.createElement('button');b.type='button';paint(b,handle);bind(b,handle,block.closest(SEL.article));block.appendChild(b);mounted.set(block,{handle,button:b});
      if(!old)block.addEventListener('mouseenter',()=>{const current=handleFromUserName(block);if(current)void request(current,'hover');},{signal:events.signal});}
    aboutLink(mounted.get(block)!.button,handle);
    if(visible(block))void request(handle,'auto');
  }
  const route=parseRoute(location.href);let button=document.getElementById('cf-profile-select') as HTMLButtonElement|null;
  if(route.handle){if(!button){const root=document.createElement('div');root.id='cf-profile-control';root.style.cssText='position:fixed;right:18px;bottom:24px;z-index:1000';button=document.createElement('button');button.id='cf-profile-select';root.appendChild(button);document.body.appendChild(root);}
    loadBadge(route.handle);paint(button,route.handle,true);aboutLink(button,route.handle);const h=route.handle;button.onclick=()=>select(h,null);
    if(!/\/about\/?$/.test(location.pathname))void request(h,'auto');
  }else document.getElementById('cf-profile-control')?.remove();
}
function schedule(){if(!alive||scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;scan();});}
async function runWorker(token:string){
  if((await readLookupSettings(chrome)).lookupMode!=='auto'||!alive)return;
  let captured:ReturnType<typeof readAbout>=null,warningTried=false,warningAt=0;
  const timer=setInterval(async()=>{if(!alive||workerDone)return;const error=aboutFailure(document);captured=readAbout(document,location.href)||captured;
    if(captured&&!warningTried){warningTried=true;const row=[...document.querySelectorAll<HTMLElement>('[data-testid="pivot"]')].find(e=>e.textContent?.startsWith('Account based in'));
      if(row&&row.querySelectorAll('svg').length>1){row.click();warningAt=Date.now();return;}}
    if(warningAt&&Date.now()-warningAt<700)return;if(!captured&&!error)return;
    workerDone=true;clearInterval(timer);const warning=locationWarning(document);if(captured&&warning){captured.accurate=false;captured.displayText=warning;}
    await chrome.runtime.sendMessage({type:'country-result',nonce:token,...(captured?{about:captured}:{error})}).catch(()=>{});
  },350);workerTimer=timer;workerDeadline=setTimeout(()=>clearInterval(timer),22000);
}
function onMessage(msg:any,_sender:any,reply:any){
  if(!alive)return false;
  if(msg.type==='cf-content-ready'){reply({version,active:true});return false;}
  if(msg.type==='country-worker-check'){reply({owned:!!nonce&&nonce===msg.nonce&&workerToken(location.href)===nonce});return false;}
  if(msg.type!=='observe')return false;
  if(parseRoute(location.href).handle?.toLowerCase()!==String(msg.handle).toLowerCase()){reply({ok:false,error:'Open this X profile to refresh its visible data.'});return false;}
  reply({ok:true,observation:observation(msg.handle,null)});return false;
}
chrome.runtime.onMessage.addListener(onMessage);
function onStorage(changes:any,area:string){
    if(!alive||area!=='local')return;
    for(const [key,change]of Object.entries(changes) as [string,any][]){
      if(key.startsWith(COUNTRY_PREFIX)){const h=key.slice(COUNTRY_PREFIX.length);if(change.newValue)records.set(h,change.newValue);else{records.delete(h);requests.delete(h);}schedule();}
      if(key.startsWith('cf:inv:')){const h=change.newValue?.subject?.handle||change.oldValue?.subject?.handle;if(h){badges.set(h.toLowerCase(),countryBadge(change.newValue,h));schedule();}}
    }
    if(changes.settings||changes[PASSIVE_MIGRATION]||changes[BACKGROUND_OPT_IN])void updateSettings();
}
async function updateSettings(){
  const generation=++settingsGeneration,s=await readLookupSettings(chrome);if(!alive||generation!==settingsGeneration)return;
  settings=s;requests.clear();
  if(!settings.enabled){for(const b of document.querySelectorAll('.cf-badge,.cf-about-link,#cf-mode-control,#cf-profile-control'))b.remove();}
  else scan();
}
if(nonce)void runWorker(nonce);
else{
  updateSettings().then(()=>{if(!alive)return;observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});}).catch(e=>{if(alive)toast('Chud Finder could not start: '+e.message);});
  addEventListener('scroll',schedule,{passive:true,signal:events.signal});addEventListener('popstate',schedule,{signal:events.signal});document.addEventListener('visibilitychange',schedule,{signal:events.signal});
  chrome.storage.onChanged.addListener(onStorage);
}
function stop(){
  if(!alive)return;alive=false;events.abort();observer?.disconnect();
  if(workerTimer)clearInterval(workerTimer);if(workerDeadline)clearTimeout(workerDeadline);
  try{chrome.runtime.onMessage.removeListener?.(onMessage);chrome.storage.onChanged.removeListener?.(onStorage);}catch{}
  for(const node of document.querySelectorAll('.cf-badge,.cf-about-link,#cf-mode-control,#cf-profile-control,#cf-message'))node.remove();
  delete document.documentElement.dataset.cfContentVersion;
}
document.addEventListener(restartEvent,stop,{signal:events.signal});
return {version,stop,active:()=>alive};
}
