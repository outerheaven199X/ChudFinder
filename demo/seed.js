/* Chud Finder demo seed. FICTIONAL accounts only (demo data). Mocks chrome.storage, the ct0 cookie and
 * X's AboutAccountQuery so the real built content script (dist/src/content.js) can run offline. */
(function () {
  const ABOUT = {
    demo_civicdesk:     { basedIn: 'United States', accurate: true,  source: 'United States App Store' },
    demo_sambawire:  { basedIn: 'Brazil',        accurate: true,  source: 'Brazil Android App' },
    demo_relaynode:     { basedIn: 'Germany',       accurate: false, source: 'Netherlands App Store' },
    sample_unlisted:    null,
    demo_osaka_eats:    { basedIn: 'Japan',         accurate: true,  source: 'Japan App Store' },
    demo_borderdesk: { basedIn: 'India',         accurate: true,  source: 'India Android App' },
    demo_statehouse:    { basedIn: 'United States', accurate: true,  source: 'Web' }
  };
  const SETTINGS = { enabled: true, showName: true, vpnWarnings: true, mismatchWarnings: true, topicMode: true, homeCountry: 'US',
    highlightCountries: ['BR'], askGrok: true, popover: true };
  document.cookie = 'ct0=demo';
  window.chrome = { storage: { local: { get: async () => ({ settings: SETTINGS }), set: async () => {}, remove: async () => {} },
    onChanged: { addListener() {} } } };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    const m = /AboutAccountQuery\?variables=(.*)$/.exec(String(url));
    if (!m) return realFetch(url, init);
    const h = JSON.parse(decodeURIComponent(m[1])).screenName;
    const a = ABOUT[h];
    const result = a === null ? { __typename: 'User', core: { screen_name: h }, about_profile: {} }
      : { __typename: 'User', core: { screen_name: h }, about_profile: { account_based_in: a.basedIn, location_accurate: a.accurate, source: a.source } };
    return new Response(JSON.stringify({ data: { user_result_by_screen_name: { result } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  // Self-reported profile locations, as page.js would forward them.
  window.__cfDemoLocations = { demo_relaynode: 'Berlin', demo_borderdesk: 'Texas, USA', demo_civicdesk: 'Ohio' };
})();
