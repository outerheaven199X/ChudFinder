# Chud Finder 3.3.1

Chud Finder is a Manifest V3 extension with automatic country badges and evidence-backed investigations of public X accounts and claims. The toolbar icon opens the full investigation panel directly. Auto/Careful and its (?) help are at the top of that panel; there is no popup menu or mode control over the X page. Click a badge to open the seven-stage workspace with visible profile/post data. The core runs locally without Grok or API credits. See [3.3.1 validation](docs/release-3.3.1.md).

Careful mode is passive by default. Saved country flags appear automatically. For an unknown account, **About ↗** is a normal link to X's About page; opening it captures the displayed fields without typing. Returning to the feed shows the saved flag wherever that handle appears. Loading, scrolling, hovering and opening an investigation initiate no background X visits in Careful mode. Profile location stays separate from X's country/region display. See [3.3.0 validation](docs/release-3.3.0.md).

Auto is optional and makes extra scripted About visits. [X's automation rules](https://help.x.com/en/rules-and-policies/x-automation) prohibit website scripting and warn of possible permanent suspension. Passive capture removes those extra visits; it is not an enforcement guarantee. The **(?)** beside each mode selector explains the distinction. See [policy and API research](docs/lookup-risk.md).

## Install

1. Run `npm ci`, `npm run typecheck`, and `npm test` with Node 22.22.2+, 24.15.0+, or 26+ and Python 3 (`python` on PATH).
2. Open `brave://extensions`, enable developer mode, and load `dist/` unpacked. The build also writes `chud-finder-3.3.1.zip` with the manifest at its root. Installing activates existing X tabs automatically. Reload the extension when replacing an unpacked build; no investigation setup is needed for saved flags.
3. **Careful** is the fresh-install and first-upgrade default. Click the toolbar icon to open the full panel. **Auto** must be selected explicitly in the panel or settings to enable background visits. Existing evidence remains local. Old settings, imports and sync documents cannot independently enable background access; returning to Careful revokes the local opt-in.
4. Flags show countries; a globe shows a broader region. Click either to investigate. Source/date and X accuracy warnings remain available. `…` means queued/loading; `!` means a lookup error; `Ⅱ` means paused; `?` means no country was displayed. Tooltips explain each state. No manual country entry is required.
5. Optional Auto uses one temporary inactive X tab, at most ten lookup starts per minute, a default daily cap of 300 (settings: 50–1000), and a 24-hour refresh interval. It pauses after recognized login/access prompts. Careful keeps dated observations and never refreshes them in the background. Use **Open X About** in an investigation to update a saved country. English X About labels are currently supported. No API credits are used for country display or capture.

Upgrading a tab that still contains pre-3.2.1 badges refreshes that X tab once to clear stale scripts. Tabs containing unsent text are left alone until their next navigation. New installations inject into existing X pages without a refresh; later activations reuse or replace their own running script without duplicate badges.

## Data providers

`src/shared/providers.ts` defines the shared typed acquisition boundary. All responses include provider identity, retrieval time, scope, actual fields, pagination and limitations.

- `UserEvidenceProvider`: explicitly selected or imported observations. Imports cannot impersonate official API provenance. About fields are labeled **USER-CAPTURED X DISPLAY**.
- `BrowserDisplayProvider`: rendered X About fields, tagged `page_observed` with a source URL and observation time. These describe what X displayed and do not establish nationality, physical location or identity.
- `XOfficialProvider`: documented X API v2 user lookup, post lookup, user timeline and recent search. No full archive or About fields are claimed. Requires approved access and sufficient provider entitlement.
- `PublicEvidenceProvider`: retrieves allowlisted public HTML sources, dates and explicit citations. Wikipedia search provides optional source discovery. A search hit is not a factual verdict.
- `OptionalGrokProvider`: one opt-in request for evidence-referenced questions, excluded from findings and receipts. No autonomous loops. The core does not call it.

Start the adapter in a local terminal. Keep keys in that terminal's environment or an OS-managed secret launcher, never in the extension or repository:

```powershell
$env:CF_EXTENSION_ORIGINS = 'chrome-extension://YOUR_EXTENSION_ID'
# Optional: X_API_BEARER_TOKEN for approved X API access.
# Optional: XAI_API_KEY and XAI_MODEL for the explicit enrichment button.
# Optional: CF_PUBLIC_HOSTS is a comma-separated allowlist of additional authorized source hosts.
npm run adapter
```

The ID is visible on the extension card. Set the panel's adapter origin to `http://127.0.0.1:8787`. The local service requires both a loopback Host header and an explicitly allowlisted extension Origin. It uses ordinary CORS, without a browser host-permission grant for loopback. Remote HTTPS adapters require a narrow optional host grant. Do not expose the loopback service to a network.

Public requests pin a validated public DNS address, reject credentials, nonstandard ports and redirects, cap response size, and time out. X/xAI credentials stay in the service. Request budgets are configurable from 1 to 20 per action. Only one retry is allowed for server errors; authentication and rate failures are not retried. Cache lifetime is five minutes. Cancellation preserves a partial snapshot. Currency cost remains unavailable when the provider does not return a defensible charge; request limits are not a dollar-price guarantee.

## What the evidence story does

The Overview shows reported-origin fields separately, self-description comparison, weak UTC posting context, within-account writing changes, keyword/topic and wording clusters, observed propagation, and a deterministic assessment. The deeper tabs expose source posts, representative pairs and clickable graph edges. Stable evidence IDs are separate from E-01 through E-08 and N-1 through N-3 display roles.

Every count is calculated from stored records. A repeated phrase, synchronized posting or shared URL does not establish common control. The earliest dated match is **EARLIEST OBSERVED COPY**, never an asserted origin. The amplifier criterion is a documented quote with at least 10,000 followers; follower count is not reach and does not establish causality.

Posting analysis defaults to 24 posts across seven dates and compares full/half windows and lower-activity days. These thresholds are heuristic and configurable at the pure-function boundary. Quiet hours are not a location or sleep estimate. Writing compares spelling/date/punctuation/length features within the account, without a native-speaker baseline.

Evidence-strength bars describe the basis of each finding, not the probability of deception. One bar is limited evidence. Two require several observations including a direct source. Three require matching dated passages from directly retrieved sources, distinct user-reviewed origin groups, and no recorded shared host, citation dependency or conflicting scoped comparison. Independence reviews and rationales are explicitly user-captured judgments. Three bars apply only to narrow passage agreement, conditional on those reviews; domains alone cannot establish independence.

## Verification tools and their limits

Retrieve a dated source and select a specific assertion. **Find matching passages** ranks candidate excerpts from the retrieved documents and shows surrounding context. Inspect a candidate before comparing it. Exact normalized agreement, equal-scope numeric differences, negation changes and removed qualifiers are deterministic. Broader semantic claims stay unverified. Conflicting scoped comparisons produce mixed evidence. Source agreement is not universal proof of truth.

Quote and organizational comparisons use the same source records. They do not reconstruct a pseudonymous person's identity. Explicit citation links form the source-dependency graph; repeated attribution is distinguished from corroboration. Retrieved ClaimReview records retain publisher ratings and dates. General Community Notes retrieval is unavailable in this adapter and is shown as such.

Media comparison computes local difference hashes for supplied images or four video frames, plus file SHA-1/SHA-256. EXIF date fields are read locally while camera, artist and GPS identifiers are excluded. Metadata dates remain editable observations, not verified event dates.

**Verify Content Credentials locally** sends a selected file (up to 16 MB) to the loopback adapter's C2PA SDK worker. Signature validity, file binding and certificate trust are separate results. The worker has a deadline; remote manifest and OCSP requests are disabled. A valid signature is not proof of the depicted event. Imported verification claims are downgraded to unverified.

**Find exact file on Commons** sends only the SHA-1 fingerprint to the documented Wikimedia API. Results preserve actual repository upload dates and links. This bounded lookup cannot find re-encoded copies or prove first publication. Optional **Google Vision** web detection sends a user-selected public image URL in one explicit, potentially paid request when `GOOGLE_VISION_API_KEY` is configured server-side. It returns matching-page candidates with unknown dates. It has not been tested with a paid live request. No detector labels images as AI-generated from appearance.

Receipts contain the current evidence set, URLs, observation/publication dates, coverage, strength reasons and correction links to earlier versions. The PNG has a source appendix; oversized reports direct the user to complete JSON. Thread drafts are local text only. There is no hosted permalink or automatic posting.

## Validation

`npm test` runs the built extension contract tests, engine tests, UI tests, legacy pure/settings tests and the retired-helper test. Removed authenticated-acquisition tests were replaced by assertions that those mechanisms are absent.

`node tools/live-investigation.mjs` launches an isolated Brave profile, loads the actual extension, connects the actual adapter, retrieves NASA's published Apollo 11 article, performs a scoped comparison and exports receipts. `BRAVE_PATH` overrides the executable path; `CF_EVIDENCE_DIR` controls artifact output. It also imports the separately labeled synthetic acceptance dataset and verifies graph interaction. No X account is logged in or automated by this test.

The synthetic fixture computes 24 account posts, a 14-post wording cluster, 20 US/EU keyword matches, nine repetitions of a phrase and 38 matching accounts across five hours. These are test records only. See the completion report and acceptance artifacts for actual results and remaining access limitations.

[Privacy and retention](docs/privacy.md) · [Store disclosures](store/data-usage-disclosures.md) · [Provider setup](server/README.md)
