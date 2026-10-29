'use strict';
const $ = id => document.getElementById(id);
const C = globalThis.CFCountries;
const S = globalThis.CFSettings;
const D = globalThis.CFLib.DEFAULT_SETTINGS;
let settings = Object.assign({}, D);

function save() {
  chrome.storage.local.set({ settings }).then(() => {
    $('saved').textContent = 'Saved';
    setTimeout(() => { $('saved').textContent = ''; }, 1200);
  });
}

function say(id, text, cls) {
  const el = $(id);
  el.textContent = text;
  el.className = 'hint' + (cls ? ' ' + cls : '');
}

function renderChosen() {
  const names = settings.highlightCountries.map(code => {
    const c = C.COUNTRIES.find(x => x.code === code);
    return c ? C.flagEmoji(c.code) + ' ' + c.name : code;
  });
  $('chosen').textContent = names.length ? 'Highlighting: ' + names.join(', ') : 'No countries highlighted.';
}

function renderList() {
  const q = $('filter').value.trim().toLowerCase();
  const list = $('list');
  list.textContent = '';
  for (const c of C.COUNTRIES) {
    if (q && !c.name.toLowerCase().includes(q)) continue;
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = settings.highlightCountries.includes(c.code);
    cb.addEventListener('change', () => {
      const set = new Set(settings.highlightCountries);
      cb.checked ? set.add(c.code) : set.delete(c.code);
      settings.highlightCountries = [...set];
      renderChosen(); save();
    });
    label.append(cb, ' ' + C.flagEmoji(c.code) + ' ' + c.name);
    list.appendChild(label);
  }
}

function fillForm() {
  for (const id of ['showName', 'askGrok', 'vpnWarnings', 'mismatchWarnings', 'topicMode']) $(id).checked = !!settings[id];
  $('homeCountry').value = settings.homeCountry || 'US';
  renderList(); renderChosen();
}

function loadSettings(raw) {
  settings = Object.assign({}, D, raw || {});
  settings.highlightCountries = Array.isArray(settings.highlightCountries) ? settings.highlightCountries.slice() : [];
}

function renderSyncState(st, url) {
  if (!url) return say('syncStatus', 'Not syncing.');
  if (!st) return say('syncStatus', 'Waiting for first sync…');
  if (st.error) return say('syncStatus', st.error, 'err');
  const when = st.lastSync ? new Date(st.lastSync).toLocaleString() : 'never';
  say('syncStatus', 'Synced from bot: ' + when + (st.warnings && st.warnings.length ? ' (' + st.warnings.join(' ') + ')' : ''), 'good');
}

// --- sync URL ---
$('saveUrl').addEventListener('click', () => {
  const u = S.checkSourceUrl($('syncUrl').value);
  if (!u) return say('syncStatus', 'Enter a plain https:// URL.', 'err');
  // Ask for access to just this one origin, right at the click (needs the user gesture).
  chrome.permissions.request({ origins: [u.origin + '/*'] }).then(async granted => {
    if (!granted) return say('syncStatus', 'Permission to read ' + u.host + ' was declined; not syncing.', 'err');
    await chrome.storage.local.set({ syncUrl: u.href, syncState: null });
    say('syncStatus', 'Syncing…');
    const r = await chrome.runtime.sendMessage({ type: 'syncNow' });
    const { syncState } = await chrome.storage.local.get('syncState');
    renderSyncState(syncState, u.href);
    if (r && r.ok) { const got = await chrome.storage.local.get('settings'); loadSettings(got.settings); fillForm(); }
  });
});

$('removeUrl').addEventListener('click', async () => {
  const { syncUrl } = await chrome.storage.local.get('syncUrl');
  await chrome.storage.local.remove(['syncUrl', 'syncState']);
  const u = S.checkSourceUrl(syncUrl);
  if (u) chrome.permissions.remove({ origins: [u.origin + '/*'] }).catch(() => {});
  $('syncUrl').value = '';
  renderSyncState(null, null);
});

// --- settings codes ---
$('applyCode').addEventListener('click', () => {
  const r = S.importCode($('code').value);
  if (!r.ok) return say('codeStatus', r.errors.join(' '), 'err');
  settings = S.merge(settings, r.settings);
  save(); fillForm();
  say('codeStatus', 'Settings applied.' + (r.warnings.length ? ' ' + r.warnings.join(' ') : ''), 'good');
});

$('exportCode').addEventListener('click', async () => {
  const code = S.exportCode(settings);
  $('code').value = code;
  try { await navigator.clipboard.writeText(code); say('codeStatus', 'Settings code copied to clipboard.', 'good'); }
  catch (_) { say('codeStatus', 'Settings code is in the box above.', 'good'); }
});

async function init() {
  const got = await chrome.storage.local.get(['settings', 'syncUrl', 'syncState']);
  loadSettings(got.settings);

  for (const id of ['showName', 'askGrok', 'vpnWarnings', 'mismatchWarnings', 'topicMode']) {
    $(id).addEventListener('change', e => { settings[id] = e.target.checked; save(); });
  }
  const sel = $('homeCountry');
  for (const c of C.COUNTRIES) sel.add(new Option(C.flagEmoji(c.code) + ' ' + c.name, c.code));
  sel.addEventListener('change', () => { settings.homeCountry = sel.value; save(); });
  $('filter').addEventListener('input', renderList);
  fillForm();

  $('syncUrl').value = got.syncUrl || '';
  renderSyncState(got.syncState, got.syncUrl);

  // Reflect background syncs while the page is open.
  chrome.storage.onChanged.addListener(async (ch, area) => {
    if (area !== 'local') return;
    if (ch.settings && JSON.stringify(ch.settings.newValue) !== JSON.stringify(settings)) { loadSettings(ch.settings.newValue); fillForm(); }
    if (ch.syncState) { const { syncUrl } = await chrome.storage.local.get('syncUrl'); renderSyncState(ch.syncState.newValue, syncUrl); }
  });
}
init();
