# Permission justifications (paste into the CWS "Privacy practices" tab)

**Single purpose:** Show the country that X reports each account is based in, plus related provenance signals, next to posts on x.com, with a local workspace for reviewing that evidence.

| Permission | Justification |
|---|---|
| `storage` | Saves the user's settings, a 24-hour lookup cache, and investigations locally (`chrome.storage.local`). Nothing is synced or sent anywhere. |
| `storage` (pacing) | Also stores the daily lookup counter and any rate-limit pause, so all tabs share one human-scale budget. |
| `alarms` | Re-checks the optional settings URL the user configured every 10 minutes (only if one is set). |
| `sidePanel` | Opens the local investigation workspace in Chrome's side panel when the user clicks "Investigate". |
| Host `https://x.com/*`, `https://twitter.com/*` | Content scripts render badges on X pages and request X's public "About this account" data in the user's own session. This is the extension's single purpose. |
| Host `https://abs.twimg.com/*` | Fetches X's public web-client script files **as text** (not executed) to find the current lookup query id when X rotates it. |
| Optional host `https://*/*` | Requested at runtime, **per origin, only when the user enters a settings sync URL** (e.g. a GitHub Gist) on the options page. Used for a plain GET of JSON data, never code. |

**Remote code:** No. All JavaScript is bundled in the package. No `eval`, no `new Function`, no remote scripts. Fetched settings are validated JSON data.
