# Chud Finder

A Chrome extension (Manifest V3) for X / Twitter. It works like the Pangram extension, but
instead of AI detection it puts a small badge next to each post's author showing where X says
the account is **based**. That way you can tell whether, say, a tweet about America is really
coming from an American account.

```
jack 🇺🇸 United States   @jack · Mar 21
someone 🇩🇪 Germany ⚠    ← X says the location may not be accurate (VPN/proxy), or it doesn't match
someone_else ?           ← X shows no "Account based in" country
```

Hover a badge to see the details: the country it's based in, the "connected via" app-store
region, the self-reported profile location, and any warnings.

## What it shows

| Badge | Meaning |
|---|---|
| 🇯🇵 Japan | X's "Account based in" value for this account |
| 🌐 South Asia | X shows a region instead of a country (it does this for some small countries) |
| amber + ⚠ | X says the location may not be accurate (`location_accurate: false`, X's VPN/proxy note), **or** the app-store region the account connects through, or the self-reported profile location, names a different country |
| pink, bold | A country *you* chose to highlight in Settings |
| dashed purple outline | Topic mode is on and the account is based outside your home country |
| grey ? | Unknown: no data, the lookup failed, or it's still loading (hover for which) |

The extension treats every country the same. Nothing is highlighted until you choose it.

## Install (unpacked)

1. Unzip `chud-finder.zip`. You should get a folder containing `manifest.json`.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle in the top right).
4. Click **Load unpacked** and pick the unzipped folder (the one that contains `manifest.json`).
5. Open https://x.com while logged in. Badges show up as tweets scroll into view.
6. Pin the extension to use the popup (on/off, clear cache). **Settings…** opens the options page.

Works in Chrome, Edge, Brave and Arc (Chromium 111+, which is needed for `world: "MAIN"` content scripts).

## Ask Grok

Click (or focus and press Enter/Space on) any badge to ask Grok about that account. Chud Finder builds a neutral prompt from what it already knows (the handle, X's "Account based in" country or region, the "Connected via" source, X's possible-VPN/proxy note, and the self-reported profile location, leaving out anything unknown), copies it to your clipboard, shows "Prompt copied, opening Grok", and opens `https://grok.com/?q=<prompt>` in a new tab. If Grok doesn't prefill the prompt, just paste it. The click doesn't open the profile on X. The prompt asks for a country-level estimate with confidence and clues, and never treats a country as a sign that posts are false. Turn it off with the "Click a badge to ask Grok" option or `"askGrok": false` in your settings document. No extra permissions are needed.

## Settings

- **Show country name** next to the flag (turn off for flag only).
- **VPN/proxy warnings**: shown when X marks the account's location as possibly inaccurate.
- **Mismatch warnings**: shown when the self-reported profile location (e.g. "Dallas, TX") or the
  "connected via" app-store region (e.g. "India Android App") names a different country from "based in".
- **Topic mode + home country** (default United States): gives accounts based outside your home
  country a subtle outline.
- **Highlight countries**: any countries you pick. The list is empty by default.

## Sync with Grok Bot

Under Settings → **Sync with Grok Bot** you can paste an `https://` settings URL, for example a raw GitHub
Gist the bot keeps for you. Chrome asks for permission to read that one site when you click Save.
Chud Finder then re-reads it on startup and every 10 minutes, and applies it when it changes. The popup shows
"Synced from bot: <time>" or the sync error. You can also paste a **settings code** from the bot, or
**export** yours. The format is documented in [SETTINGS_SCHEMA.md](SETTINGS_SCHEMA.md). Documents are
validated strictly and treated as data only; nothing remote is ever executed. Bot-side tools
(`bot/lookup.py`, `bot/SKILL.md`) are described in [bot/README.md](bot/README.md).

## How it works

- `src/page.js` runs in the page's own JS world. It only observes X's own GraphQL requests:
  it picks up the web client's current bearer token and the `AboutAccountQuery` query id (if the page
  uses one), and the self-reported `location` of users in timeline responses.
- `src/content.js` watches the timeline with a `MutationObserver` plus an `IntersectionObserver`,
  so only tweets near the screen get looked up. It reads each author's handle from
  `[data-testid="User-Name"]`, and quoted tweets are covered too. It then calls
  `GET https://x.com/i/api/graphql/<queryId>/AboutAccountQuery?variables={"screenName":"<handle>"}`
  as a same-origin request with your logged-in session: `credentials: include`, the web client's
  bearer token, and `x-csrf-token` taken from the `ct0` cookie. It reads
  `data.user_result_by_screen_name.result.about_profile.{account_based_in, location_accurate, source}`.
- Results are cached in `chrome.storage.local` for 24 h (6 h for "no data"). Requests for the same
  handle are deduplicated. Lookups run one at a time, at least 1.5 s apart, newest-seen first. On
  HTTP 429 it pauses all tabs until `x-rate-limit-reset`, or 15 minutes if that header is missing.
- If the query id stops working (HTTP 400/404), the service worker reads X's own client JS bundles
  from `abs.twimg.com` to find the current `AboutAccountQuery` query id.
- There are no external servers, analytics, remote code or dependencies. Data only goes between
  your browser and x.com.

## Tests

```
node test/settings.test.js                               # settings schema, codes, background sync (no deps)
npm i jsdom && NODE_PATH=./node_modules node test/test.js  # DOM / content-script tests (jsdom, dev only)
python3 bot/test_lookup.py                               # bot lookup script against a fake local server
```

The tests cover handle extraction, including quoted tweets, from a sample tweet DOM; response
parsing; source and location parsing; badge rendering for every state; and an integration run
of the real `content.js`/`page.js` in jsdom with mocked `chrome.storage` and `fetch`. That run
checks rendering, the cache, in-flight dedupe, the auth headers, and 429 back-off.

## Known limitations

- **You have to be logged in to X.** The endpoint needs your session. Logged out, every badge is grey ?.
- **It relies on an undocumented internal X endpoint.** X can rename it, change the query id or
  the response shape, or add request signing at any time. Query-id rotation is handled automatically;
  other changes would need a code update.
- **Rate limits.** X limits how often this endpoint can be called (the exact limit isn't published).
  Heavy scrolling through new accounts will hit it. Badges then stay grey/pending until the pause
  ends, and cached accounts still show.
- **It shows X's data, not ground truth.** "Based in" is X's own estimate. The VPN note
  means X thinks the location *may* be inaccurate, not that a VPN is confirmed. A location is context
  for judging a post, not proof that it's true or false.
- The mismatch check on the self-reported location is a best-effort text match. It knows country
  names and US states, so free text like "earth" or "NYC ↔ LDN" is ignored.
- Settings sync needs a host that serves the file over https and answers a plain GET. A raw GitHub Gist is the
  tested pattern. GitHub's raw cache can delay an update by a few minutes on top of the 10-minute check.
- X's DOM changes now and then. If badges stop appearing, the `data-testid="User-Name"` selector may
  need updating.
