/* Chud Finder side panel workspace: Overview | Origin | Narrative | Claims | Evidence. */
import { currentSnapshot } from '../shared/engine.ts';
import { buildExport, threadDraft } from '../shared/receipts.ts';
import { Investigation } from '../shared/schemas.ts';
import { el, renderTab, TABS } from './render.ts';
import type { Tab } from './render.ts';
import { drawReceipt, receiptFontsReady } from './receipt-png.ts';
import {
  ACTIVE_KEY,
  INDEX_KEY,
  INV_PREFIX,
  deleteInvestigation,
  loadInvestigation,
} from './store.ts';
import type { IndexEntry } from './store.ts';
import { fingerprint, fileDigests } from './media.ts';
import { GROK_BOT_TEMPLATE_URL } from './config.ts';
import { matchingPassages } from '../shared/analysis.ts';
import type { SourceDocument } from '../shared/schemas.ts';

declare const chrome: any;
const $ = (id: string) => document.getElementById(id)!;
const store = chrome.storage.local;

let inv: Investigation | null = null;
let version: number | undefined;
let tab: Tab = 'Overview';
let evidenceAll = false;
let botUrl = GROK_BOT_TEMPLATE_URL;
let showGeneration = 0;

function download(name: string, blob: Blob) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}

function status(msg: string, cls = '') {
  const s = $('status');
  s.textContent = msg;
  s.className = 'status mono ' + cls;
}

function note(type: string) {
  if (!inv) return;
  void chrome.runtime
    .sendMessage({
      type: 'record-export',
      handle: inv.subject.handle,
      version: currentSnapshot(inv, version).version,
      format: type,
    })
    .then((r: any) => {
      if (!r?.ok) status('Receipt saved; event logging failed.', 'amber');
    });
}

function onAction(a: { type: string; [k: string]: unknown }) {
  if (!inv) return;
  const fname = 'chud-finder-' + inv.subject.handle + '-v' + currentSnapshot(inv, version).version;
  switch (a.type) {
    case 'ask-grok':
      window.open(String(a.url), '_blank', 'noopener');
      break;
    case 'show-evidence': {
      tab = 'Evidence';
      evidenceAll = true;
      render();
      const t = document.getElementById('evidence-' + a.id);
      if (t) {
        t.classList.add('flash');
        if (typeof t.scrollIntoView === 'function') t.scrollIntoView({ block: 'center' });
      }
      break;
    }
    case 'evidence-scope':
      evidenceAll = !!a.all;
      render();
      break;
    case 'export-json':
      download(
        fname + '.json',
        new Blob([JSON.stringify(buildExport(inv, version), null, 2)], {
          type: 'application/json',
        }),
      );
      note('JSON');
      break;
    case 'export-png': {
      const c = document.createElement('canvas');
      const cur = inv;
      void receiptFontsReady()
        .then(() => {
          drawReceipt(c, cur, version);
          c.toBlob((b) => {
            if (b) {
              download(fname + '.png', b);
              note('PNG');
            }
          }, 'image/png');
        })
        .catch((e) => status(e.message, 'amber'));
      break;
    }
    case 'thread': {
      const parts = threadDraft(inv, version);
      const box = $('thread') as HTMLTextAreaElement;
      box.value = parts.join('\n\n');
      $('threadWrap').hidden = false;
      box.focus();
      box.select();
      note('X thread draft');
      break;
    }
  }
}

function render() {
  const nav = $('tabs');
  nav.textContent = '';
  for (const t of TABS) {
    const b = el(document, 'button', 'tab mono' + (t === tab ? ' active' : ''), t.toUpperCase());
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t === tab));
    b.addEventListener('click', () => {
      tab = t;
      render();
    });
    nav.appendChild(b);
  }
  updateSourceControls();
  const main = $('main');
  main.textContent = '';
  const vsel = $('version') as HTMLSelectElement;
  vsel.textContent = '';
  if (!inv) {
    main.appendChild(
      el(
        document,
        'p',
        'na',
        'No investigation yet. Open Investigation & Source Controls, or select a CF badge on X.',
      ),
    );
    (vsel as any).hidden = true;
    return;
  }
  (vsel as any).hidden = false;
  for (const s of [...inv.snapshots].reverse())
    vsel.add(
      new Option(
        'v' + s.version + ' \u00b7 ' + new Date(s.createdAt).toLocaleString(),
        String(s.version),
      ),
    );
  vsel.value = String(version ?? inv.currentVersion);
  main.appendChild(
    renderTab({ doc: document, inv, version, grokBotTemplateUrl: botUrl, onAction }, tab, {
      evidenceAll,
    }),
  );
}

async function renderRecent() {
  const got = await store.get(INDEX_KEY);
  const idx: IndexEntry[] = got[INDEX_KEY] || [];
  const sel = $('recent') as HTMLSelectElement;
  sel.textContent = '';
  if (!idx.length) sel.add(new Option('No investigations', ''));
  for (const e of idx) sel.add(new Option('@' + e.handle + ' \u00b7 v' + e.version, e.id));
  if (inv) sel.value = inv.id;
}

async function show(id: string | null) {
  const generation=++showGeneration;
  const loaded=id ? await loadInvestigation(store, id) : null;
  if(generation!==showGeneration)return;
  inv=loaded;
  version = undefined;
  evidenceAll = false;
  await renderRecent();
  if(generation!==showGeneration)return;
  render();
  if (inv) status('Updated ' + new Date(inv.updatedAt).toLocaleString());
}

async function init() {
  watchUpdates();
  const initialGeneration=showGeneration;
  const q = new URLSearchParams(location.search).get('inv');
  const got = await store.get([ACTIVE_KEY, 'settings']);
  if (
    got.settings &&
    typeof got.settings.grokBotTemplateUrl === 'string' &&
    got.settings.grokBotTemplateUrl
  )
    botUrl = got.settings.grokBotTemplateUrl;
  if(initialGeneration===showGeneration)await show(q || got[ACTIVE_KEY] || null);
  await initControls();
  ($('recent') as HTMLSelectElement).addEventListener('change', (e) =>
    show((e.target as HTMLSelectElement).value || null),
  );
  ($('version') as HTMLSelectElement).addEventListener('change', (e) => {
    version = Number((e.target as HTMLSelectElement).value);
    render();
  });
  $('refresh').addEventListener('click', async () => {
    if (!inv) return;
    status('Refreshing saved evidence; use Open X About to update the country in Careful mode.');
    const r = await chrome.runtime.sendMessage({
      type: 'reinvestigate',
      handle: inv.subject.handle,
      localOnly: true,
    });
    if (!r || !r.ok) status((r && r.error) || 'Refresh failed', 'amber');
  });
  $('delete').addEventListener('click', async () => {
    if (!inv) return;
    await deleteInvestigation(store, inv.id);
    const g = await store.get(ACTIVE_KEY);
    await show(g[ACTIVE_KEY] || null);
    status('Deleted.');
  });
  $('copyThread').addEventListener('click', async () => {
    const box = $('thread') as HTMLTextAreaElement;
    try {
      await navigator.clipboard.writeText(box.value);
      status('Thread draft copied. Nothing was posted.');
    } catch {
      box.select();
      document.execCommand('copy');
    }
  });
  $('closeThread').addEventListener('click', () => {
    $('threadWrap').hidden = true;
  });
}
function watchUpdates() {
  chrome.storage.onChanged.addListener((ch: any, area: string) => {
    if (area !== 'local') return;
    if (ch[ACTIVE_KEY] && ch[ACTIVE_KEY].newValue) {
      show(ch[ACTIVE_KEY].newValue);
      return;
    }
    if (ch[ACTIVE_KEY + ':pending'] && ch[ACTIVE_KEY + ':pending'].newValue)
      status('Investigating @' + ch[ACTIVE_KEY + ':pending'].newValue.handle + '\u2026');
    if (inv && ch[INV_PREFIX + inv.id] && ch[INV_PREFIX + inv.id].newValue) {
      const r = Investigation.safeParse(ch[INV_PREFIX + inv.id].newValue);
      if (r.success && r.data.currentVersion !== inv.currentVersion) {
        inv = r.data;
        version = undefined;
        renderRecent();
        render();
        status('Updated to v' + inv.currentVersion);
      }
    }
    if (ch.settings && ch.settings.newValue) {
      botUrl = ch.settings.newValue.grokBotTemplateUrl || GROK_BOT_TEMPLATE_URL;
      render();
    }
  });
}
init().catch(e=>status('Could not load the investigation: '+e.message,'amber'));
function value(id: string) {
  return ($(id) as HTMLInputElement).value.trim();
}
function updateSourceControls() {
  const select = $('sourceSelect') as HTMLSelectElement;
  if (!select) return;
  const selected = select.value;
  select.textContent = '';
  if (!inv) return;
  const s = currentSnapshot(inv, version);
  for (const e of inv.evidence.filter(
    (e) => s.evidenceIds.includes(e.id) && e.kind === 'source_document',
  )) {
    const document = e.value.document as any;
    select.add(
      new Option(
        document.title + ' | ' + (document.publishedAt || 'publication date unavailable'),
        document.url,
      ),
    );
  }
  if ([...select.options].some((o) => o.value === selected)) select.value = selected;
  sourceText();
}
function sourceText() {
  if (!inv) return;
  const s = currentSnapshot(inv, version);
  const doc = inv.evidence.find(
    (e) =>
      s.evidenceIds.includes(e.id) &&
      e.url === value('sourceSelect') &&
      e.kind === 'source_document',
  )?.value.document as any;
  $('sourceText').textContent = doc ? doc.text : '';
}
async function initControls() {
  const config = await store.get('providerSettings');
  ($('adapterUrl') as HTMLInputElement).value = config.providerSettings?.url || '';
  ($('requestBudget') as HTMLInputElement).value = String(
    config.providerSettings?.maxRequests || 8,
  );
  ($('aboutAt') as HTMLInputElement).value = new Date().toISOString();
  $('sourceSelect').addEventListener('change', sourceText);
  const run = async (type: string, payload: any = {}) => {
    const handle = payload.handle || inv?.subject.handle || value('accountHandle');
    status('Collecting evidence…');
    const r = await chrome.runtime.sendMessage({ type, handle, ...payload });
    if (!r?.ok) throw new Error(r?.error || 'Action failed');
    if (r.id) await show(r.id);
    status(
      type === 'cancel'
        ? 'Cancellation requested; collected evidence will be retained.'
        : 'Evidence saved.',
    );
    return r;
  };
  const bind = (id: string, fn: () => Promise<any>) =>
    $(id).addEventListener('click', () => void fn().catch((e) => status(e.message, 'amber')));
  bind('startInvestigation', () =>
    run('start', { handle: value('accountHandle').replace(/^@/, ''), localOnly:true }),
  );
  bind('loadApiPosts',()=>run('reinvestigate'));
  bind('cancelInvestigation', () => run('cancel'));
  const capabilities = async () => {
    const r = await chrome.runtime.sendMessage({ type: 'provider-capabilities' });
    $('providerState').textContent = r?.ok
      ? `X API: ${r.x ? 'configured' : 'unavailable'}; Grok: ${r.grok ? 'configured (opt-in)' : 'unavailable'}.`
      : r?.error || 'Provider unavailable';
    $('enrichGrok').hidden = !r?.grok;
    $('searchGoogleMedia').hidden = !r?.mediaSearch?.google;
  };
  bind('saveProvider', async () => {
    const u = new URL(value('adapterUrl'));
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== '/' ||
      !(u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === '127.0.0.1'))
    )
      throw new Error('Use an HTTPS origin or http://127.0.0.1:port');
    if (u.hostname !== '127.0.0.1') {
      const granted = await chrome.permissions.request({ origins: [u.origin + '/*'] });
      if (!granted) throw new Error('Provider permission was not granted');
    }
    await store.set({
      providerSettings: {
        url: u.origin,
        maxRequests: Math.max(1, Math.min(20, Number(value('requestBudget')) || 8)),
      },
    });
    await capabilities();
  });
  bind('captureAbout', () =>
    run('capture-about', {
      about: {
        basedIn: value('basedIn') || null,
        source: value('connectedVia') || null,
        accurate: value('accuracy') === '' ? null : value('accuracy') === 'true',
        notFound: false,
        observedAt: value('aboutAt'),
        sourceUrl: value('aboutUrl'),
        displayText: value('accuracyText'),
        provenance: 'user_captured',
      },
    }),
  );
  bind('searchPropagation', () =>
    run('search-propagation', {
      query: value('propagationQuery'),
      start: value('searchStart') || undefined,
      end: value('searchEnd') || undefined,
    }),
  );
  bind('retrieveSources', () =>
    run('retrieve-sources', {
      query: value('sourceQuery'),
      urls: value('sourceUrl') ? [value('sourceUrl')] : [],
    }),
  );
  bind('compareSource', () =>
    run('compare-source', {
      url: value('sourceSelect'),
      claim: value('claimText'),
      passage: value('sourcePassage'),
      kind: value('comparisonKind'),
    }),
  );
  bind('findPassages', async () => {
    if (!inv) throw new Error('Start an investigation and retrieve sources first');
    const snap = currentSnapshot(inv, version),
      documents = inv.evidence
        .filter((e) => snap.evidenceIds.includes(e.id) && e.kind === 'source_document')
        .map((e) => e.value.document as SourceDocument);
    const matches = matchingPassages(value('claimText'), documents),
      root = $('passageMatches');
    root.textContent = matches.length
      ? 'Candidate passages from retrieved sources. Select and inspect the surrounding context before comparing.'
      : 'No matching passage in retrieved sources. The original remains unavailable.';
    for (const match of matches) {
      const box = el(document, 'section', 'card'),
        label = el(
          document,
          'p',
          'meta',
          match.url + ' / ' + (match.publishedAt || 'publication date unavailable'),
        ),
        context = el(document, 'p', 'statement', match.context),
        choose = el(document, 'button', 'btn', 'Use this passage');
      choose.addEventListener('click', () => {
        ($('sourceSelect') as HTMLSelectElement).value = match.url;
        ($('sourcePassage') as HTMLTextAreaElement).value = match.passage;
        $('sourceSelect').dispatchEvent(new Event('change'));
      });
      box.append(label, context, choose);
      root.append(box);
    }
  });
  bind('reviewSource', () =>
    run('review-source', {
      url: value('sourceSelect'),
      group: value('sourceGroup'),
      rationale: value('sourceRationale'),
    }),
  );
  bind('importEvidence', async () => {
    const f = ($('evidenceFile') as HTMLInputElement).files?.[0];
    if (!f || f.size > 1_000_000)
      throw new Error('Choose an AccountObservation JSON file under 1 MB');
    const observation = JSON.parse(await f.text());
    if (!inv || inv.subject.handle.toLowerCase() !== String(observation.handle).toLowerCase())
      await run('start', { handle: observation.handle });
    return run('import-evidence', {
      handle: observation.handle,
      observation,
      correction: value('correctionReason') || undefined,
    });
  });
  const mediaSamples = async () => {
    const f = ($('mediaFile') as HTMLInputElement).files?.[0];
    if (!f) throw new Error('Choose media to compare');
    const samples = await fingerprint(f);
    const digests = await fileDigests(f);
    return {
      file: f,
      samples: samples.map((sample) => ({
        ...sample,
        ...digests,
        url: value('mediaUrl'),
        observedAt: new Date().toISOString(),
        publishedAt: value('mediaPublished') || null,
        claimedEventDate: value('mediaClaimed') || null,
        provenance: 'user_captured' as const,
      })),
    };
  };
  bind('addMedia', async () => {
    const { samples } = await mediaSamples();
    for (const media of samples) await run('add-media', { media });
  });
  bind('verifyMedia', async () => {
    const f = ($('mediaFile') as HTMLInputElement).files?.[0];
    if (!f || f.size > 16_000_000)
      throw new Error('Choose a file under 16 MB for local Content Credentials verification');
    const { file, samples } = await mediaSamples();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Cannot read selected file'));
      reader.readAsDataURL(file);
    });
    await run('verify-media', { samples, data, mimeType: file.type });
  });
  const searchMedia = async (provider: 'commons' | 'google') => {
    const f = ($('mediaFile') as HTMLInputElement).files?.[0];
    if (!f) throw new Error('Choose and fingerprint a file before searching');
    const { sha1 } = await fileDigests(f);
    return run('media-search', { sha1, imageUrl: value('mediaUrl') || undefined, provider });
  };
  bind('searchCommonsMedia', () => searchMedia('commons'));
  bind('searchGoogleMedia', () => searchMedia('google'));
  bind('enrichGrok', async () => {
    const r = await run('enrich');
    $('grokSuggestions').textContent =
      'UNVERIFIED QUESTIONS (excluded from findings and receipts): ' +
      r.suggestions.map((s: any) => s.question + ' [' + s.evidenceIds.join(', ') + ']').join('\n');
  });
  if (config.providerSettings?.url) void capabilities().catch(e=>{$('providerState').textContent=e.message;});
}
