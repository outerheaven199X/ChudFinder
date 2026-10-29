# Chud Finder

A browser-native provenance layer for X, as a Manifest V3 extension for **Chrome and Brave**.

- **Badges:** next to each author, the country X's own *About this account* says the account is based in. Includes flag images that also work on Windows, VPN/proxy and mismatch warnings, highlights you choose, and topic mode.
- **Popover:** click a badge to see the account's provenance. That covers *Based in*, *Connected via*, X's location note (each with its source and when it was seen in your session) and the self-reported profile location. Anything missing shows as *Unavailable*. From there you can **Investigate** or **Ask Grok**.
- **Side panel workspace** (`chrome.sidePanel`), with five tabs: **Overview | Origin | Narrative | Claims | Evidence**.
  - **Origin X-Ray** and **VPN Detective** are computed deterministically in the extension. Every finding is labeled *reported*, *self-described*, *corroborated*, *inferred* or *unknown*. Conflicts are listed, and you get **"Location undetermined"** when the evidence doesn't support a single country.
  - **Narrative** and **Claims** show only what's observable on the page: post text, links, quotes, replies and timestamps. Each post gets an **Ask Grok** button with a neutral prompt tailored to it (claim verification or narrative spread). There's also an optional **Deep investigation with Chud Finder Grok Bot** link. The extension does no fake analysis here.
  - **Evidence**: every stored evidence item with its source, observed/first/last-seen times and link. Findings cite these items by id.
  - **Receipts**: a PNG card (canvas), a JSON export (cited evidence only) and a copyable X thread draft. Nothing is posted automatically.
- **Local storage:** investigations live in `chrome.storage.local`. They have stable ids, versioned snapshots (Refresh creates v2, v3, ...) and append-only evidence history. The last 50 appear in a recent list.

There's **no server.** Everything runs in your browser and uses your own logged-in X session. Data only goes between your browser and x.com, plus grok.com when you click Ask Grok.

> Principle: expose the origin of influence, show the evidence, and let the reader decide. A location is context about where an account operates. It is never treated as evidence that its posts are true or false. Findings stay at country level and never infer nationality.

## Install (Brave or Chrome, Windows/macOS/Linux)

1. Get `chud-finder-<version>.zip` (from a build, see below) and extract it to a folder, e.g. `Desktop\chud-finder`.
   `manifest.json` is at the top of the zip, so the folder you extract to is the one you pick.
2. Open `brave://extensions` (Brave) or `chrome://extensions` (Chrome).
3. Turn on **Developer mode**, click **Load unpacked**, and choose that folder.
   *Updating:* extract over the same folder, click the reload arrow on Chud Finder, and refresh X.
4. Open https://x.com while logged in. Click a badge, then **Investigate**, and the side panel opens.
   (Brave: if the side panel doesn't appear, the workspace opens in a tab instead. The popup's **Investigations...** button opens it too.)

Needs Chromium 116+ (side panel API). The settings gist URL you already use keeps working.

## Build & test

```
npm install
npm run build      # -> dist/ (unpacked extension) + chud-finder-<version>.zip  (Node >= 22.18)
npm test           # build + all tests (node:test TS suites, legacy 1.2.0 suites, python bot tests)
npm run typecheck  # tsc --noEmit
```

## Layout

```
src/shared/   typed contracts + zod schemas (Account, Evidence, Finding, Claim, Post, RelationshipEdge,
              Investigation, Snapshot, InvestigationEvent, Export), deterministic engine, sanitizer,
              Ask Grok prompts, receipts, country + tz tables, settings schema (schemaVersion 1)
src/ext/      content script, X DOM adapter (versioned), popover, background, side panel, store, options, popup
static/       manifest.json, HTML/CSS, flag font, icons
test/         *.test.ts (node --test), legacy/*.cjs (1.2.0 suites run against dist/)
tools/        build.mjs (esbuild + zip), gen-tz.py, validate-settings.cjs, shots/ (fixture screenshots)
bot/          Grok Bot lookup helpers (python)
verification/ test results, fixture screenshots
```

## How it works

- `page.js` runs in the page's own JS world and only observes X's own GraphQL traffic. It picks up the web client's bearer token and the `AboutAccountQuery` id, the self-reported `location` of users, and the recent posts in timeline responses (id, text, time, language tag, links). It only posts messages to the content script.
- The content script reads `About this account` (`GET /i/api/graphql/<id>/AboutAccountQuery`) as a same-origin request with your session. It caches results (24 h, or 6 h when there's no data), dedupes lookups, spaces them out, and backs off on 429.
- **Investigate** builds an `AccountObservation` from what this tab has seen: the About data with `observedAt`, the self-described location, and on-page plus timeline posts. It's validated with zod and sent to the service worker, which runs the engine and stores the new version.
- **The engine** (`src/shared/engine.ts`) makes evidence with stable ids: same source, kind, subject and value gives the same id, and a re-observation just updates `lastSeenAt`. Findings come from that evidence, and every one passes citation validation. A finding citing evidence that doesn't exist, a reported/inferred finding with no citation, a country not supported by the cited evidence, or text crossing the hard boundaries is rejected and logged as a `validation_failed` event.
- **VPN Detective signals:** X's location-accuracy note, *Connected via* vs *Based in*, the self-described location vs *Based in*, and the posting-hour pattern. The quietest 6-hour window gives a UTC-offset band of ±3h, checked against tzdata offsets per country. The likely operating region is *reported* when nothing conflicts. Otherwise it's a low/medium-confidence *inferred* country when the signals clearly agree, or **Location undetermined**.
- **Untrusted text** (posts, profile fields) is cleaned (control, zero-width and bidi characters stripped) and rendered with `textContent` only. Links must be `https:`. In Ask Grok prompts the text is quoted inside `<< >>` as data, with fixed instructions last, so a post can't rewrite the request.

## Settings

See [SETTINGS_SCHEMA.md](SETTINGS_SCHEMA.md). This is still **schemaVersion 1**. 2.0 adds two optional keys, `popover` and `grokBotTemplateUrl`, and older documents stay valid.

## Known limitations

- **Logged-in X required.** *About this account* only works in your session. Logged out, badges are grey `?` and investigations show unknown states.
- **Undocumented X endpoint and DOM.** Query-id rotation is handled. Other changes need an update, and selectors are isolated in `src/ext/xdom.ts` (`ADAPTER_VERSION`).
- **X data isn't ground truth.** *Based in* is X's estimate, and the VPN note means X thinks the location *may* be inaccurate.
- **Observations are limited to what your tab has seen.** Scroll an account's profile before Investigate to give the posting-hour signal enough posts (it needs at least 12).
- **No narrative scoring or claim verification inside the extension.** Those go to Ask Grok or the Grok Bot, and their answers are hypotheses to check.
- **Receipts are local files or text.** There's no public permalink because there's no server.
- **Rate limits:** X limits the endpoint, so heavy scrolling pauses lookups until the limit resets.
