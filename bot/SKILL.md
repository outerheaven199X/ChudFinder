---
name: chud-finder
description: When the user asks where an X account is based, whether an account may be using a VPN/proxy, whether a post's author is really from the country it talks about, or asks to change their Chud Finder extension settings or get a settings code.
---
# Chud Finder

Chud Finder shows X's own "About this account" data (Account based in, VPN/proxy note, Connected via)
next to posts. This skill covers three jobs: looking up an account, updating the user's settings gist,
and handing out a settings code.

**Always neutral.** Where an account is based is a signal, not proof. Report what X says, with its
source, and let the user judge. Never describe a nationality or country as a misinformation source,
and don't pick countries to highlight unless the user asks for them.

## 1. Look up an account

Use the first route that works:

1. **lookup.py, with the user's own cookies.** Only use cookies the user gave you, as a file path or
   environment variables (`X_AUTH_TOKEN`, `X_CT0`). Never ask them to paste cookies into chat; ask for a
   file path instead.
   `python3 /workspace/chud-finder/bot/lookup.py <handle> --cookies <path>`
   - Exit 3 means rate limited: wait (about 15 min) and don't retry in a loop.
   - Exit 1 with an auth error means the cookies have expired; ask the user to refresh them.
   - HTTP 400/404 means the query id may have rotated. Find the current
     `queryId:"…",operationName:"AboutAccountQuery"` in X's client JS and pass `--query-id`.
2. **The box browser, if the user is signed in to X there.** Open `https://x.com/<handle>/about` and read
   "Account based in", any "may not be accurate" or VPN/proxy note, and "Connected via".
3. **Weak fallback.** Grok Bot's built-in X tools (public API v2 user lookup) only return the
   self-reported profile `location`. Use it only when 1 and 2 aren't possible, and label it clearly:
   "self-reported profile location, not X's 'Account based in' data".

Report it like this:
`@handle: based in <country> (X "About this account"). Connected via <source>. X notes the location may not be accurate (possible VPN/proxy).`
Add the last sentence only when `location_accurate` is false. If routes 1 or 2 gave no profile location,
add the self-reported location from the X tools, labelled as self-reported. Say "unknown" when X shows nothing.

## 2. Update the user's settings gist (only when the user asks)

The extension can sync from a raw Gist URL. The format is in `/workspace/chud-finder/SETTINGS_SCHEMA.md`
(`schemaVersion: 1`; booleans `enabled`, `showName`, `askGrok`, `vpnWarnings`, `mismatchWarnings`, `topicMode`;
`homeCountry`; `highlightCountries`, which takes ISO codes or English names).

1. Change only the keys the user asked about, and always keep `"schemaVersion": 1`. Add `"updatedAt"`
   (ISO time) and `"note": "updated by Grok Bot"` if you like.
2. Before writing, validate the document:
   `node -e "require('/workspace/chud-finder/src/countries.js');const S=require('/workspace/chud-finder/src/settings-schema.js');const r=S.parseAndValidate(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(r));process.exit(r.ok?0:1)" < settings.json`
3. Write it with the user's own GitHub auth: their connected GitHub tool, or `gh` if they're logged in.
   - Create (first time): `gh gist create --filename chud-finder-settings.json settings.json` (secret by default).
   - Update: `gh api -X PATCH /gists/<id> -f "files[chud-finder-settings.json][content]=$(cat settings.json)"`.
   - REST equivalent: `PATCH https://api.github.com/gists/<id>` with
     `{"files":{"chud-finder-settings.json":{"content":"<json>"}}}`.
   Only write to a gist the user created or named for this purpose, and tell them what you changed.
4. The URL the user pastes into Chud Finder → Settings → *Sync with Grok Bot* is
   `https://gist.githubusercontent.com/<user>/<gist-id>/raw/chud-finder-settings.json`. Leave out the commit
   SHA so it always points at the latest version. The extension checks every 10 minutes, and GitHub's raw cache
   can add a few minutes; the user can click Save again to sync immediately. A secret gist is unlisted, not
   private: don't put anything sensitive in it.

## 3. Hand out a settings code

For users who don't want a gist: build the same JSON, validate it (step 2.2), and give them
`base64(UTF-8 JSON)` to paste into Settings → *Settings code* → Apply code:
`python3 -c "import base64,json,sys;print(base64.b64encode(json.dumps(json.load(sys.stdin),separators=(',',':')).encode()).decode())" < settings.json`
Show the decoded JSON next to the code so the user can see exactly what it changes. To read a code a user sends you,
base64-decode it and validate it the same way.
