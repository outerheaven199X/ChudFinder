import { AboutObservation } from '../shared/schemas.ts';
import type { AboutObservation as About } from '../shared/schemas.ts';
import { cleanHandle } from './xdom.ts';

export const COUNTRY_PREFIX = 'cf:country:';
export type CountryRecord = {handle:string;status:'queued'|'loading'|'ready'|'unavailable'|'error'|'paused';about:About|null;message:string;updatedAt:number;expiresAt:number};
type Job = {handle:string;reason:string;nonce:string;tabId?:number;resolve?:(r:CountryRecord)=>void};
const DAY=86400000;
export class CountryLookup {
  private jobs:Job[]=[];
  private active:Job|null=null;
  private running=false;
  private pending=new Set<string>();
  private nextAt=0;
  private writes=0;
  private chrome:any;
  private onResult:(h:string,a:About)=>Promise<void>;
  private interval:number;
  private timeout:number;
  constructor(chrome:any,onResult:(h:string,a:About)=>Promise<void>,interval=6000,timeout=20000) {
    this.chrome=chrome;this.onResult=onResult;this.interval=interval;this.timeout=timeout;
  }
  async settings() {const g=await this.chrome.storage.local.get(['settings','cf:lookupV32']);return {...g.settings,lookupMode:g['cf:lookupV32']?g.settings?.lookupMode || 'auto':'auto'};}
  async write(record:CountryRecord) {
    await this.chrome.storage.local.set({[COUNTRY_PREFIX+record.handle.toLowerCase()]:record});
    if(++this.writes%25===0){const all=await this.chrome.storage.local.get(null);const keys=Object.keys(all).filter(k=>k.startsWith(COUNTRY_PREFIX)).sort((a,b)=>(all[b]?.updatedAt||0)-(all[a]?.updatedAt||0));if(keys.length>1500)await this.chrome.storage.local.remove(keys.slice(1500));}
    return record;
  }
  record(h:string,status:CountryRecord['status'],message:string,about:About|null=null,ttl=300000):CountryRecord {const now=Date.now();return{handle:h,status,message,about,updatedAt:now,expiresAt:now+ttl};}
  async request(handle:string,reason='auto') {
    const h=cleanHandle(handle)?.toLowerCase();if(!h)throw new Error('Invalid handle');
    const s=await this.settings();
    if(s.enabled===false || (reason==='auto'&&s.lookupMode!=='auto'))return {ok:true,skipped:true};
    const cached=(await this.chrome.storage.local.get(COUNTRY_PREFIX+h))[COUNTRY_PREFIX+h] as CountryRecord|undefined;
    if(reason!=='refresh' && cached && cached.expiresAt>Date.now() && ['ready','unavailable'].includes(cached.status))return {ok:true,record:cached};
    if(cached?.status==='error'&&cached.expiresAt>Date.now()&&reason==='auto')return {ok:true,record:cached};
    if(this.pending.has(h)){
      const index=this.jobs.findIndex(j=>j.handle===h);
      if(reason!=='auto'&&index>=0){const [job]=this.jobs.splice(index,1);job.reason=reason;this.jobs.unshift(job);}
      return {ok:true,queued:true};
    }
    if(this.jobs.length>=30)return {ok:true,skipped:true};
    const job={handle:h,reason,nonce:crypto.randomUUID()};
    this.pending.add(h);
    reason==='auto'?this.jobs.push(job):this.jobs.unshift(job);
    await this.write(this.record(h,'queued','Waiting to read X About…',cached?.about || null,60000));
    void this.pump();return {ok:true,queued:true};
  }
  private async closeOwned(job:Job) {
    if(job.tabId==null)return;
    try {const r=await this.chrome.tabs.sendMessage(job.tabId,{type:'country-worker-check',nonce:job.nonce});if(r?.owned)await this.chrome.tabs.remove(job.tabId);}catch{}
    await this.chrome.storage.session?.remove?.('cf:countryWorker');
  }
  private async pump() {
    if(this.running)return;this.running=true;
    try {while(this.jobs.length){
      const job=this.jobs.shift()!;
      try {
      const s=await this.settings();
      if(s.enabled===false || (job.reason==='auto'&&s.lookupMode!=='auto')){await this.write(this.record(job.handle,'paused','Careful mode: hover or click to look up this account.'));continue;}
      const pacing=(await this.chrome.storage.local.get('cf:countryPacing'))['cf:countryPacing'] || {};
      const day=new Date().toLocaleDateString('en-CA'),count=pacing.day===day?Number(pacing.count)||0:0;
      if(pacing.pausedUntil>Date.now()) {await this.write(this.record(job.handle,'paused',pacing.message || 'X lookups paused. Try later.'));continue;}
      if(count>=Math.max(50,Math.min(1000,Number(s.dailyCap)||300))) {await this.write(this.record(job.handle,'paused','Daily country lookup limit reached. Change it in Chud Finder settings.'));continue;}
      const wait=Math.max(0,this.nextAt-Date.now(),(pacing.nextAt||0)-Date.now());
      if(wait)await new Promise(r=>setTimeout(r,Math.min(wait,this.interval)));
      const current=await this.settings();
      if(current.enabled===false || (job.reason==='auto'&&current.lookupMode!=='auto')){await this.write(this.record(job.handle,'paused','Automatic lookup stopped by your setting.'));continue;}
      this.active=job;await this.write(this.record(job.handle,'loading','Reading X About…',null,this.timeout+5000));
      this.nextAt=Date.now()+this.interval;
      await this.chrome.storage.local.set({'cf:countryPacing':{day,count:count+1,nextAt:this.nextAt}});
      let timer:ReturnType<typeof setTimeout>|undefined;
      try {
        const result=new Promise<CountryRecord>(resolve=>{job.resolve=resolve;timer=setTimeout(()=>resolve(this.record(job.handle,'error','X About did not load. Click to retry, or open the account’s About page.')),this.timeout);});
        const tab=await this.chrome.tabs.create({url:`https://x.com/${job.handle}/about#cf-country-read=${job.nonce}`,active:false});job.tabId=tab.id;
        await this.chrome.storage.session?.set?.({'cf:countryWorker':{tabId:job.tabId,nonce:job.nonce}});
        const record=await result;await this.write(record);
        // A panel-store error must not erase a successfully acquired country.
        if(record.about)await this.onResult(job.handle,record.about).catch(()=>{});
        if(record.status==='error'&&/sign in|paused access/i.test(record.message))await this.chrome.storage.local.set({'cf:countryPacing':{day,count:count+1,pausedUntil:Date.now()+300000,message:record.message}});
      } catch(e:any){await this.write(this.record(job.handle,'error',String(e.message).slice(0,200)));}
      finally {if(timer)clearTimeout(timer);await this.closeOwned(job);this.active=null;}
      } finally {this.pending.delete(job.handle);}
    }}finally{this.running=false;}
  }
  async accept(message:any,sender:any) {
    const job=this.active;
    if(!job || sender.tab?.id!==job.tabId || message.nonce!==job.nonce)return {ok:false,error:'No matching country lookup'};
    const url=new URL(sender.url || 'https://invalid.invalid');
    if(url.origin!=='https://x.com'||url.pathname.toLowerCase()!==`/${job.handle}/about`)return {ok:false,error:'Country page mismatch'};
    if(message.error){job.resolve?.(this.record(job.handle,'error',String(message.error).slice(0,240)));return{ok:true};}
    const about=AboutObservation.parse(message.about);
    if(about.sourceUrl?.toLowerCase()!==`https://x.com/${job.handle}/about`||about.provenance!=='page_observed')throw new Error('About source mismatch');
    job.resolve?.(this.record(job.handle,about.basedIn?'ready':'unavailable',about.basedIn?'X About read automatically.':'X did not display a country or region.',about,about.basedIn?DAY:3600000));
    return{ok:true};
  }
  async observe(handle:string,about:About,sender:any) {
    const h=cleanHandle(handle)?.toLowerCase(),url=new URL(sender.url || 'https://invalid.invalid');
    if(!h || !['x.com','twitter.com'].includes(url.hostname)||url.pathname.toLowerCase()!==`/${h}/about`)throw new Error('About page subject mismatch');
    const value=AboutObservation.parse(about);
    if(value.provenance!=='page_observed'||value.sourceUrl?.toLowerCase()!==`https://x.com/${h}/about`)throw new Error('About source mismatch');
    await this.write(this.record(h,value.basedIn?'ready':'unavailable','Read from the open X About page.',value,value.basedIn?DAY:3600000));
    await this.onResult(h,value);return{ok:true};
  }
  async recover() {
    const orphan=(await this.chrome.storage.session?.get?.('cf:countryWorker'))?.['cf:countryWorker'];
    if(orphan)await this.closeOwned({...orphan,handle:'',reason:'recovery'});
  }
}
