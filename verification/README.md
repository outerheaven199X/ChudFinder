# Verification (Chud Finder 2.1.0)

Run: `npm install && npm test` (builds first). Output from the last run: [test-results.txt](test-results.txt).

| Suite | Command | Tests |
|---|---|---|
| New TS suites (schemas, engine, citations, prompt injection, XSS/render, DOM adapter, receipts, built extension integration, side panel) | `node --test test/*.test.ts` | 34 |
| Legacy 1.2.0 settings + background sync (run against `dist/`) | `node test/legacy/settings.test.cjs` | 16 |
| Legacy 1.2.0 DOM / content / page / Ask Grok (jsdom, against `dist/`) | `node test/legacy/test.cjs` | 19 |
| Bot lookup helper | `python3 bot/test_lookup.py` | 7 |

## Live-tested vs fixture-only

- **Live:** the user's real settings gist (`schemaVersion 1`) was fetched and validated by the built schema (`tools/validate-settings.cjs`): ok, no warnings.
- **Fixture only (not yet run on live X):** everything that needs a logged-in X session, which includes badges on the real timeline, the popover, Investigate, and the side panel in Brave. These are covered by jsdom runs of the *built* `content.js`, `page.js`, `background.js` and `sidepanel.js` with mocked `chrome.*` and recorded-shape X responses. Nothing was run against X itself from the build machine, since X blocks sign-in there.
- **Screenshots** in `screenshots/` are headless-Chrome renders of the real UI code (`tools/shots/`) with a **fixture** investigation (`@sample_acct`). They are not captures of live X.
