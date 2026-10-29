# Privacy and data use

Chud Finder 3.0 performs investigations only after an explicit user action. Content scripts add selection controls on X and Twitter. A selected post's public text, author handle, URL, timestamp and visible links may be read when the user chooses Investigate. No scrolling-based collection occurs. No private messages, browsing-history inventory, cookies, browser authorization tokens or intercepted traffic are collected.

## Storage and deletion

Settings and investigation records are stored in `chrome.storage.local`, not Chrome Sync. The store retains up to 50 investigations and the newest 20 snapshots per investigation. Older entries are evicted when those limits are reached. Evidence needed by retained snapshots is retained, along with up to 200 events. New snapshots link to their preceding version; corrections do not overwrite retained older snapshots. These are record-count limits, not a guarantee of available browser storage; a browser quota failure is reported and does not silently discard source records.

The panel's Delete control removes the selected investigation and its stored versions. Uninstalling the extension removes extension-local records. Exported JSON, PNG and text files are separate local copies; users manage those files themselves. No report is published automatically.

## Optional provider transfers

The configured adapter receives the selected public handle/post identifier, requested search phrase/date scope or explicit source URL. The adapter may send those requests to the documented X API and allowlisted public source hosts. The default public hosts include NASA and Wikipedia. Source discovery uses Wikipedia, not an undisclosed whole-web search. Any additional hosts must be explicitly configured by the adapter operator.

The local adapter binds to loopback, accepts only allowlisted extension origins, and retains a bounded five-minute JSON cache in memory. It writes no evidence or credentials to disk and sends no unrelated browsing data. API credentials remain in the service environment. Provider-specific retention policies apply to requests received by those providers.

Opt-in Grok enrichment sends up to 100 evidence IDs and short summaries to xAI. Its output is labeled unverified questions, excluded from findings and receipts. There is no automatic model call. API token counts are recorded when returned; currency charges are not invented.

Selected media files are decoded and fingerprinted locally. The extension stores hashes, user-provided public URLs/dates, dimensions and limited metadata observations, not the original files. No media upload, facial identification, precise-location extraction or AI-image authenticity verdict is performed.

Optional settings sync retains the existing HTTPS settings-file feature. A user-granted origin is fetched at startup and every ten minutes; data is validated and never executed. The request omits cookies. The configured server can observe a normal network request and associated IP address.

## Permissions

`storage`: settings and evidence. `alarms`: optional settings sync. `sidePanel`: investigation workspace. X/Twitter content-script matches: lightweight selection UI. Optional HTTPS host permissions: specific settings and remote adapter origins chosen by the user. Loopback provider calls use origin-restricted CORS. No cookies, webRequest, debugger, clipboard-read or browsing-history permission is requested.
