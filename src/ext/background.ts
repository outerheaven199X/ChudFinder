/* Chud Finder - service worker.
 * 1) Settings sync: if the user set a "Settings source URL" (https only), fetch it on
 *    startup and every 10 minutes, validate it strictly (data only, never executed),
 *    and apply it when its content changes.
 * 2) Authorized providers: user-triggered, bounded requests to a credential-isolating service.
 * 3) Investigations: validate observations from the content script, run the deterministic
 *    engine, persist versioned investigations locally and open the side panel.
 */
import * as S from '../shared/settings-schema.ts';
import { DEFAULT_SETTINGS as DEFAULTS } from './lib.ts';
import {
  AccountObservation,
  Coverage,
  SourceDocument,
  MediaVerification,
} from '../shared/schemas.ts';
import { investigationId, upsertInvestigation, currentSnapshot } from '../shared/engine.ts';
import { loadInvestigation, saveInvestigation, ACTIVE_KEY } from './store.ts';
import { CountryLookup, COUNTRY_PREFIX } from './country-lookup.ts';
import { activateOpenXTabs } from './installation.ts';

import {
  XOfficialProvider,
  PublicEvidenceProvider,
  UserEvidenceProvider,
  OptionalGrokProvider,
  coverage,
} from '../shared/providers.ts';
declare const chrome: any;
const ALARM = 'cf-settings-sync';
const PERIOD_MIN = 10;

// ---------------- settings sync ----------------
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function setState(patch: Record<string, unknown>) {
  const { syncState = {} } = await chrome.storage.local.get('syncState');
  await chrome.storage.local.set({
    syncState: Object.assign(syncState, patch, { lastChecked: Date.now() }),
  });
}

let syncing: Promise<any> | null = null;
function syncNow(force: boolean): Promise<any> {
  if (!syncing)
    syncing = doSync(force).finally(() => {
      syncing = null;
    });
  return syncing;
}

async function doSync(force: boolean): Promise<any> {
  const { syncUrl, syncState = {} } = await chrome.storage.local.get(['syncUrl', 'syncState']);
  if (!syncUrl) return { ok: true, skipped: true };
  const u = S.checkSourceUrl(syncUrl);
  if (!u) {
    await setState({ error: 'Settings source URL must be https.' });
    return { ok: false };
  }

  const origin = u.origin + '/*';
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    await setState({
      error: 'Permission to read ' + u.host + ' was not granted. Save the URL again in Settings.',
    });
    return { ok: false };
  }

  let text: string;
  try {
    const res = await fetch(u.href, { cache: 'no-store', credentials: 'omit', redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (res.url && !res.url.startsWith('https:')) throw new Error('redirected to a non-https URL');
    const len = Number(res.headers.get('content-length') || 0);
    if (len > S.MAX_BYTES) throw new Error('document larger than 64 KB');
    text = await res.text();
  } catch (e: any) {
    await setState({ error: 'Could not fetch settings: ' + ((e && e.message) || e) });
    return { ok: false };
  }

  const result = S.parseAndValidate(text);
  if (!result.ok) {
    await setState({
      error: 'Settings rejected: ' + result.errors.join(' '),
      warnings: result.warnings,
    });
    return { ok: false, errors: result.errors };
  }

  const hash = await sha256(text);
  // Apply only when the remote document changed, so local tweaks stick until the bot updates it.
  if (force || hash !== syncState.hash) {
    const { settings = {} } = await chrome.storage.local.get('settings');
    const merged = S.merge(Object.assign({}, DEFAULTS, settings), result.settings);
    await chrome.storage.local.set({ settings: merged });
  }
  await setState({
    error: null,
    hash,
    lastSync: Date.now(),
    warnings: result.warnings,
    url: u.href,
  });
  return { ok: true, warnings: result.warnings };
}

async function ensureAlarm() {
  const a = await chrome.alarms.get(ALARM);
  if (!a) chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN, delayInMinutes: PERIOD_MIN });
}

chrome.alarms.onAlarm.addListener((a: any) => {
  if (a.name === ALARM) syncNow(false);
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  syncNow(false);
  void activateOpenXTabs(chrome).catch(console.error);
});

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings)
    await chrome.storage.local.set({
      settings: Object.assign({}, DEFAULTS, { highlightCountries: [] }),
    });
  const migration = await chrome.storage.local.get('cf:lookupV32');
  if (!migration['cf:lookupV32']) await chrome.storage.local.set({settings:{...DEFAULTS,...settings,lookupMode:'auto'},'cf:lookupV32':true});
  await activateOpenXTabs(chrome);
  await ensureAlarm();
  syncNow(false);
});

// ---------------- authorized investigations ----------------
const active = new Map<string, AbortController>();
const queues = new Map<string, Promise<any>>();
const empty = (handle: string): AccountObservation => ({
  handle,
  observedAt: new Date().toISOString(),
  pageUrl: 'https://x.com/' + handle,
  adapterVersion: 'provider@3',
  about: null,
  profileLocation: null,
  posts: [],
  focusPostId: null,
});
async function adapter(signal?: AbortSignal) {
  const got = await chrome.storage.local.get('providerSettings'),
    settings = got.providerSettings || {};
  const url = settings.url || '';
  if (!url) throw new Error('Adapter not configured. User-supplied evidence remains available.');
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1'))
    throw new Error('Adapter must use HTTPS or loopback HTTP');
  if (u.username || u.password || u.search || u.hash) throw new Error('Invalid adapter URL');
  // Loopback uses ordinary CORS restricted by the adapter to this extension ID.
  // Remote adapters require an explicit host grant; no wildcard grant is requested.
  if (
    u.hostname !== '127.0.0.1' &&
    !(await chrome.permissions.contains({ origins: [u.origin + '/*'] }))
  )
    throw new Error('Adapter host permission not granted');
  const telemetry = {
    requests: 0,
    posts: 0,
    profiles: 0,
    tokens: null as number | null,
    cost: null as number | null,
    cacheHits: 0,
    failures: 0,
    status: 'partial',
  };
  const maxRequests = Math.max(1, Math.min(20, Number(settings.maxRequests) || 8));
  const send = async (operation: string, payload: unknown) => {
    if (telemetry.requests >= maxRequests) throw new Error('Investigation request budget reached');
    const response = await fetch(u.origin + '/provider', {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, payload, budget: maxRequests - telemetry.requests }),
    });
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('Adapter response too large');
    const result = JSON.parse(text);
    if (!response.ok) {
      telemetry.failures++;
      throw new Error(result.error || 'Adapter HTTP ' + response.status);
    }
    telemetry.requests += result.telemetry?.requests || 0;
    telemetry.failures += result.telemetry?.failures || 0;
    telemetry.cacheHits += result.telemetry?.cacheHits || 0;
    return result.result;
  };
  return { send, telemetry, settings };
}
function previousObservation(inv: any): AccountObservation {
  const s = currentSnapshot(inv),
    evidence = inv.evidence.filter((e: any) => s.evidenceIds.includes(e.id));
  const based = evidence.find((e: any) => e.kind === 'about_based_in'),
    via = evidence.find((e: any) => e.kind === 'about_connected_via'),
    acc = evidence.find((e: any) => e.kind === 'about_location_accuracy');
  return AccountObservation.parse({
    ...empty(inv.subject.handle),
    about:
      based || via || acc
        ? {
            basedIn: based?.value.basedIn || null,
            source: via?.value.raw || null,
            accurate: acc?.value.accurate ?? null,
            notFound: false,
            observedAt: (based || via || acc).observedAt,
            sourceUrl: (based || via || acc).url,
            provenance: (based || via || acc).provenance === 'page_observed' ? 'page_observed' : 'user_captured',
            ...((acc?.value.original) ? {displayText:acc.value.original} : {}),
          }
        : null,
    profileLocation: s.account.profileLocation
      ? {
          text: s.account.profileLocation,
          observedAt:
            evidence.find((e: any) => e.kind === 'profile_location')?.observedAt || s.createdAt,
        }
      : null,
    posts: s.posts,
    focusPostId: s.focusPostId,
    searchText: evidence.find((e: any) => e.kind === 'propagation')?.value.query,
    sources: evidence
      .filter((e: any) => e.kind === 'source_document')
      .map((e: any) => e.value.document),
    media: evidence.filter((e: any) => e.kind === 'media').map((e: any) => e.value.media),
    coverage: s.coverage,
    provider: 'UserEvidenceProvider',
  });
}
async function save(raw: AccountObservation, activate = true) {
  const obs = AccountObservation.parse(raw),
    id = investigationId(obs.handle),
    prev = await loadInvestigation(chrome.storage.local, id),
    inv = upsertInvestigation(prev, obs);
  await saveInvestigation(chrome.storage.local, inv, activate);
  return { ok: true, id, version: inv.currentVersion };
}
async function investigate(raw: unknown, localOnly = false) {
  const obs = new UserEvidenceProvider(raw).observation,
    controller = new AbortController();
  const prior = await loadInvestigation(chrome.storage.local, investigationId(obs.handle));
  const retained = prior ? previousObservation(prior) : null;
  if (retained) {
    obs.about ||= retained.about;
    obs.profileLocation ||= retained.profileLocation;
    obs.sources = retained.sources;
    obs.media = retained.media;
    obs.searchText = retained.searchText;
    obs.posts = [...new Map([...obs.posts,...retained.posts].map(p=>[p.id,p])).values()].slice(0,100);
  }
  const cached=(await chrome.storage.local.get(COUNTRY_PREFIX+obs.handle.toLowerCase()))[COUNTRY_PREFIX+obs.handle.toLowerCase()];
  if(cached?.about?.provenance==='page_observed') {obs.about=cached.about;obs.provider='BrowserDisplayProvider';}
  if(localOnly) {
    obs.coverage=[...(retained?.coverage || []),coverage('BrowserDisplayProvider','Visible X page and automatic About lookup',obs.posts.length,['Only currently rendered posts; use the optional API action for a larger sample.'])].slice(-30);
    return save(obs);
  }
  active.set(obs.handle.toLowerCase(), controller);
  const coverageList: Coverage[] = [
    ...(retained?.coverage || []),
    coverage('UserEvidenceProvider', 'Explicit account/post selection', obs.posts.length, [
      'No feed crawling. No external search performed for this selection.',
    ]),
  ];
  try {
    const a = await adapter(controller.signal),
      caps = (await a.send('capabilities', {})) as any;
    if (caps.x) {
      const provider = new XOfficialProvider(a.send);
      const profile = await provider.getAccount(obs.handle);
      coverageList.push(profile.coverage);
      if (profile.observation?.profileLocation) {
        obs.profileLocation = profile.observation.profileLocation;
        obs.provider = 'XOfficialProvider';
        a.telemetry.profiles++;
      }
      const result = await provider.getPosts({ handle: obs.handle, limit: 50 });
      coverageList.push(result.coverage);
      const map = new Map(obs.posts.map((p) => [p.id, p]));
      for (const p of result.posts) map.set(p.id, p);
      obs.posts = [...map.values()].slice(0, 100);
      a.telemetry.posts = result.posts.length;
      if (obs.focusPostId) {
        const focus = await provider.getPost(obs.focusPostId);
        coverageList.push(focus.coverage);
        for (const p of focus.posts) map.set(p.id, p);
        obs.posts = [...map.values()].slice(0, 100);
      }
    } else
      coverageList.push(
        coverage(
          'XOfficialProvider',
          obs.handle,
          0,
          ['Approved X API access is not configured.'],
          'unavailable',
        ),
      );
    a.telemetry.status = coverageList.some((c) => c.status !== 'ok') ? 'partial' : 'complete';
    obs.telemetry = a.telemetry;
  } catch (e: any) {
    coverageList.push(
      coverage(
        'XOfficialProvider',
        obs.handle,
        0,
        [String(e.message)],
        controller.signal.aborted
          ? 'cancelled'
          : /budget/i.test(e.message)
            ? 'budget'
            : 'unavailable',
      ),
    );
  } finally {
    active.delete(obs.handle.toLowerCase());
  }
  obs.coverage = coverageList.slice(-30);
  return save(obs);
}
async function modify(msg: any) {
  const prev = await loadInvestigation(chrome.storage.local, investigationId(String(msg.handle)));
  if (!prev) throw new Error('Investigation unavailable');
  if (msg.type === 'record-export') {
    currentSnapshot(prev, Number(msg.version));
    prev.events = [
      ...prev.events,
      {
        at: new Date().toISOString(),
        type: 'exported' as const,
        version: Number(msg.version),
        detail: 'Exported ' + String(msg.format).slice(0, 50),
      },
    ].slice(-200);
    await saveInvestigation(chrome.storage.local, prev);
    return { ok: true };
  }
  const obs = previousObservation(prev),
    controller = new AbortController();
  active.set(obs.handle.toLowerCase(), controller);
  try {
    if (msg.type === 'capture-about') {
      const input = new UserEvidenceProvider({ ...empty(obs.handle), about: msg.about })
        .observation;
      obs.about = input.about;
    } else if (msg.type === 'import-evidence') {
      const imported = new UserEvidenceProvider(msg.observation).observation;
      if (imported.handle.toLowerCase() !== obs.handle.toLowerCase())
        throw new Error('Import subject mismatch');
      return save({ ...imported, correction: msg.correction || 'Explicit user evidence import' });
    } else if (msg.type === 'compare-source') {
      const source = obs.sources?.find((s) => s.url === msg.url);
      if (!source) throw new Error('Retrieve the source before comparing');
      source.comparisons = [
        ...(source.comparisons || []),
        { claim: msg.claim, passage: msg.passage, kind: msg.kind },
      ];
      SourceDocument.parse(source);
      if (!source.text.includes(msg.passage))
        throw new Error('Passage is not present in the retrieved source');
    } else if (msg.type === 'review-source') {
      const source = obs.sources?.find((s) => s.url === msg.url);
      if (!source) throw new Error('Retrieve the source before reviewing it');
      source.independenceReview = {
        group: msg.group,
        rationale: msg.rationale,
        reviewedAt: new Date().toISOString(),
        provenance: 'user_captured',
      };
      SourceDocument.parse(source);
    } else if (msg.type === 'add-media') {
      obs.media = [...(obs.media || []), msg.media];
    } else if (msg.type === 'verify-media') {
      const settings = (await chrome.storage.local.get('providerSettings')).providerSettings;
      if (!settings?.url || new URL(settings.url).hostname !== '127.0.0.1')
        throw new Error('File verification requires the local loopback adapter. No file was sent.');
      const a = await adapter(controller.signal);
      const verification = MediaVerification.parse(
        await a.send('verify-media', { data: msg.data, mimeType: msg.mimeType }),
      );
      if (verification.sha256 !== msg.samples?.[0]?.sha256)
        throw new Error('Verified file hash does not match selected media');
      obs.media = [
        ...(obs.media || []),
        ...msg.samples.map((m: any) => ({ ...m, verification })),
      ].slice(-50);
      obs.telemetry = a.telemetry;
    } else {
      const a = await adapter(controller.signal);
      if (msg.type === 'search-propagation') {
        const r = await new XOfficialProvider(a.send).getPosts({
          text: String(msg.query).slice(0, 512),
          limit: 100,
          ...(msg.start ? { start: msg.start } : {}),
          ...(msg.end ? { end: msg.end } : {}),
        });
        // Keep the selected claim, then prefer the new query's sample over older search rows.
        const focus = obs.posts.find((p) => p.id === obs.focusPostId);
        const map = new Map((focus ? [focus] : []).map((p) => [p.id, p]));
        for (const p of r.posts) map.set(p.id, p);
        for (const p of obs.posts) if (!map.has(p.id)) map.set(p.id, p);
        obs.posts = [...map.values()].slice(0, 100);
        obs.searchText = msg.query;
        if (map.size > 100) r.coverage.limitations.push('Combined sample capped at 100 posts.');
        obs.coverage = [...(obs.coverage || []), r.coverage].slice(-30);
        a.telemetry.posts = r.posts.length;
      } else if (msg.type === 'retrieve-sources') {
        const r = await new PublicEvidenceProvider(a.send).searchClaims({
          text: msg.query || '',
          ...(msg.urls?.length ? { urls: msg.urls } : {}),
        });
        const docs = new Map((obs.sources || []).map((s) => [s.url, s]));
        for (const source of r.sources) docs.set(source.url, source);
        obs.sources = [...docs.values()].slice(-20);
        obs.coverage = [...(obs.coverage || []), r.coverage].slice(-30);
      } else if (msg.type === 'media-search') {
        const r = await new PublicEvidenceProvider(a.send).searchMedia({
          sha1: msg.sha1,
          imageUrl: msg.imageUrl,
          provider: msg.provider,
        });
        const matches = obs.media?.filter((m) => m.sha1 === msg.sha1) || [];
        if (!matches.length) throw new Error('Fingerprint the selected file before searching');
        for (const m of matches) m.instances = r.instances;
        obs.coverage = [...(obs.coverage || []), r.coverage].slice(-30);
      } else if (msg.type === 'enrich') {
        const result = await new OptionalGrokProvider(a.send).enrich(
          prev.evidence
            .filter((e) => currentSnapshot(prev).evidenceIds.includes(e.id))
            .map((e) => ({ id: e.id, summary: e.summary })),
        );
        a.telemetry.tokens = result.tokens;
        obs.telemetry = a.telemetry;
        obs.coverage = [
          ...(obs.coverage || []),
          coverage('OptionalGrokProvider', 'Explicit enrichment; questions excluded from findings', 0, [
            'No model-generated factual evidence was added.',
          ]),
        ].slice(-30);
        const saved = await save(obs);
        return { ...saved, ...result };
      } else throw new Error('Unsupported action');
      obs.telemetry = a.telemetry;
    }
  } catch (e: any) {
    if (
      msg.type === 'enrich' ||
      msg.type === 'compare-source' ||
      msg.type === 'capture-about' ||
      msg.type === 'add-media' ||
      msg.type === 'verify-media' ||
      msg.type === 'review-source'
    )
      throw e;
    obs.coverage = [
      ...(obs.coverage || []),
      coverage(
        'provider',
        msg.query || '',
        0,
        [String(e.message)],
        controller.signal.aborted
          ? 'cancelled'
          : /budget/i.test(e.message)
            ? 'budget'
            : 'unavailable',
      ),
    ].slice(-30);
  } finally {
    active.delete(obs.handle.toLowerCase());
  }
  obs.correction = msg.correction || 'Added evidence; compare with previous version.';
  return save(obs);
}
function openPanel(sender: any) {
  const tabId = sender?.tab?.id;
  return tabId != null && chrome.sidePanel?.open
    ? chrome.sidePanel.open({ tabId }).then(
        () => true,
        () => false,
      )
    : Promise.resolve(false);
}
const countryLookup = new CountryLookup(chrome, async (handle,about) => {
  // Automatic cache updates must not steal the active investigation or race a click.
  const key=handle.toLowerCase();
  const task=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
    const prev=await loadInvestigation(chrome.storage.local,investigationId(handle));
    if(prev)await save({...previousObservation(prev),about,provider:'BrowserDisplayProvider',observedAt:new Date().toISOString()},false);
  });
  queues.set(key,task);
  try{await task;}finally{if(queues.get(key)===task)queues.delete(key);}
});
void countryLookup.recover().catch(()=>{});
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
chrome.runtime.onMessage.addListener((msg: any, sender: any, reply: (r: any) => void) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (['lookup-country','country-result','about-observed'].includes(msg?.type)) {
    const page=sender.url ? new URL(sender.url) : null;
    const extensionPage=!sender.tab && sender.id===chrome.runtime.id;
    if(!extensionPage && (!page || !['x.com','twitter.com'].includes(page.hostname))) {reply({ok:false,error:'X page required'});return false;}
    const action=msg.type==='lookup-country'?countryLookup.request(msg.handle,msg.reason):msg.type==='country-result'?countryLookup.accept(msg,sender):countryLookup.observe(msg.handle,msg.about,sender);
    action.then(reply,e=>reply({ok:false,error:String(e.message)}));return true;
  }
  if (msg?.type === 'syncNow') {
    ensureAlarm();
    syncNow(true).then(reply);
    return true;
  }
  if (msg?.type === 'cancel') {
    active.get(String(msg.handle).toLowerCase())?.abort();
    reply({ ok: true });
    return false;
  }
  if (msg?.type === 'provider-capabilities') {
    adapter()
      .then((a) => a.send('capabilities', {}))
      .then(
        (r) => reply({ ok: true, ...(r as any) }),
        (e) => reply({ ok: false, error: e.message }),
      );
    return true;
  }
  const mutations = [
    'record-export',
    'investigate',
    'start',
    'reinvestigate',
    'capture-about',
    'import-evidence',
    'search-propagation',
    'retrieve-sources',
    'compare-source',
    'add-media',
    'verify-media',
    'media-search',
    'review-source',
    'enrich',
  ];
  if (!mutations.includes(msg?.type)) return false;
  const handle = String(msg.observation?.handle || msg.handle || '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    reply({ ok: false, error: 'Invalid account handle' });
    return false;
  }
  const opened = msg.type === 'investigate' ? openPanel(sender) : Promise.resolve(true);
  chrome.storage.local.set({ [ACTIVE_KEY + ':pending']: { handle, at: Date.now() } });
  const key = handle.toLowerCase();
  const task = (queues.get(key) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const r =
        msg.type === 'investigate'
          ? await investigate(msg.observation,!!msg.localOnly)
          : msg.type === 'start' || msg.type === 'reinvestigate'
            ? await investigate(empty(handle),!!msg.localOnly)
            : await modify(msg);
      if (r.ok && !(await opened))
        await chrome.tabs.create({
          url: chrome.runtime.getURL('src/sidepanel.html?inv=' + (r as any).id),
        });
      if(msg.localOnly)void countryLookup.request(handle,msg.type==='reinvestigate'?'refresh':'click').catch(()=>{});
      return r;
    });
  queues.set(key, task);
  task
    .then(reply, (e) => reply({ ok: false, error: String(e.message) }))
    .finally(() => {
      if (queues.get(key) === task) queues.delete(key);
    });
  return true;
});
