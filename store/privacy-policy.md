# Privacy and data use

Chud Finder 3.3 defaults to passive Careful mode. It reads rendered public X About fields when the user opens an About page, stores them locally with the source and date, and displays saved flags automatically. The About ↗ control is a normal link that opens the selected account's page. Loading, scrolling, hovering and opening investigations do not initiate background X visits in this mode. The extension does not extract cookies, authorization tokens or intercepted traffic, collect private messages or inventory browsing history.

Optional Auto uses one temporary inactive X tab in the existing signed-in session, with at most ten lookup starts per minute, a configurable daily cap (default 300), and a 24-hour refresh interval. X receives those extra visits. Recognized login/access prompts pause lookups. Choosing Auto explicitly in the local mode selector is required; prior settings or imported/synchronized settings cannot grant that opt-in. Returning to Careful revokes it.

Clicking a badge saves visible public post text, author handles, URLs, timestamps and links, plus self-described location when on that profile. The investigation opens immediately with available saved evidence. An About page opened later updates saved flags and any existing investigation. Source URLs, observation times and displayed location-accuracy warnings are retained. Country fields are not inferred from profile location, bio or language. New installs and the first update to 3.3 use Careful; subsequent explicit mode choices are retained.

The **(?)** beside each mode selector explains the account risk. Auto scripts X page visits; [X's automation rules](https://help.x.com/en/rules-and-policies/x-automation) prohibit this and warn of permanent suspension. Careful removes those extra visits; it is not a guarantee about enforcement. Switching to Careful stops all queued background visits, including hover/click/refresh jobs; a visit already running may finish. Turning Enabled off stops new lookups. Cache limits and pacing are implementation limits, not X-approved limits.

## Storage and deletion

Settings and investigation records are stored in `chrome.storage.local`, not Chrome Sync. The store retains up to 50 investigations and the newest 20 snapshots per investigation. Older entries are evicted when those limits are reached. Evidence needed by retained snapshots is retained, along with up to 200 events. New snapshots link to their preceding version; corrections do not overwrite retained older snapshots. These are record-count limits, not a guarantee of available browser storage; a browser quota failure is reported and does not silently discard source records.

The separate country cache retains up to 1500 recent entries, pruned every 25 cache writes. Missing-country responses expire after one hour; errors after five minutes. Expiration controls Auto refresh eligibility; Careful continues displaying saved observations with their dates and sends no refresh request. A worker-tab ID and ownership nonce are stored only for the browser session so a restarted service worker can clean up its own temporary tab. A user-navigated tab is left open. Clear cache in the popup removes country-cache entries without deleting investigation history.

The panel's Delete control removes the selected investigation and its stored versions. Uninstalling the extension removes extension-local records. Exported JSON, PNG and text files are separate local copies; users manage those files themselves. No report is published automatically.

## Optional provider transfers

The configured adapter receives the selected public handle/post identifier, requested search phrase/date scope or explicit source URL. The adapter may send those requests to the documented X API and allowlisted public source hosts. The default public hosts include NASA and Wikipedia. Source discovery uses Wikipedia, not an undisclosed whole-web search. Any additional hosts must be explicitly configured by the adapter operator.

The local adapter binds to loopback, accepts only allowlisted extension origins, and retains a bounded five-minute JSON cache in memory. It writes no evidence or credentials to disk and sends no unrelated browsing data. API credentials remain in the service environment. Provider-specific retention policies apply to requests received by those providers.

Opt-in Grok enrichment sends up to 100 evidence IDs and short summaries to xAI. Its output is labeled unverified questions, excluded from findings and receipts. There is no automatic model call. API token counts are recorded when returned; currency charges are not invented.

Selected media files are decoded and fingerprinted locally. Only selected EXIF date/software fields are retained; artist, camera and GPS identifiers are excluded. The extension stores hashes, URLs, dates and verification results, not original files. The explicit Content Credentials control sends a file of up to 16 MB to a loopback-only adapter, which validates it in memory with the C2PA SDK. Remote manifests and online OCSP fetching are disabled. No original file is written by the adapter.

Commons exact-file search sends only a SHA-1 fingerprint to commons.wikimedia.org. Optional Google Vision web detection sends the selected public image URL to Google in one explicit, potentially paid request when configured. Provider retention policies apply. Results preserve retrieval time and distinguish repository upload dates from unknown dates. No facial identification, precise-location extraction or appearance-based AI-image verdict is performed.

Source independence reviews store a user-entered organization/group, rationale and review time. They remain labeled user judgments; they do not turn source-domain counts into proof of independent corroboration.

Optional settings sync retains the existing HTTPS settings-file feature. A user-granted origin is fetched at startup and every ten minutes; data is validated and never executed. The request omits cookies. The configured server can observe a normal network request and associated IP address.

## Permissions

`storage`: settings, country cache and evidence. `alarms`: optional settings sync. `sidePanel`: investigation workspace. `scripting` and explicit X/Twitter host permissions activate flags on already-open X/Twitter pages at installation, update and browser startup. Injection remains restricted to those two HTTPS sites and the main frame; other tabs are not inspected. Content-script matches handle future navigations. A legacy X tab may refresh once during upgrade; a tab with unsent text is left alone. Activation results retain only tab IDs, statuses, time and bounded error messages locally, not page contents or unrelated URLs. Optional HTTPS host permissions cover specific settings and remote adapter origins chosen by the user. Loopback provider calls use origin-restricted CORS. No cookies, webRequest, debugger, clipboard-read or browsing-history permission is requested.
