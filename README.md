# Chud Finder 3.1.3

Chud Finder is a Manifest V3 extension for explicit, evidence-backed investigations of public X accounts and claims. The seven-stage workspace runs locally without Grok. It retains the ANTIMEME design, five tabs, versioned evidence store and PNG/JSON/thread receipts.

This is a release candidate. Approved X API access is required for live post collection and recent-search propagation. The adapter never uses browser cookies, internal GraphQL endpoints, intercepted tokens or feed crawling. X's self-described profile location is never substituted for its operating-region display. See the [completion report and acceptance artifacts](docs/COMPLETION.md) for the tested scope and remaining limitations.

## Install

1. Run `npm ci`, `npm run typecheck`, and `npm test` with Node 22.22.2+, 24.15.0+, or 26+ and Python 3 (`python` on PATH).
2. Open `brave://extensions`, enable developer mode, and load `dist/` unpacked. The build also writes `chud-finder-3.1.3.zip` with the manifest at its root.
3. Open **Investigations** from the toolbar, or click the country badge beside an X username to open its investigation directly. Saved About observations show a flag and country on load; regions show a globe and missing observations show `?`. Hover exposes the recorded source and date. Profile location is never used as an operating-country flag. Nothing is collected when you scroll or hover.
4. User observations and JSON imports work immediately. For programmatic sources, configure the optional local adapter below.

## Authorized providers

`src/shared/providers.ts` defines the shared typed acquisition boundary. All responses include provider identity, retrieval time, scope, actual fields, pagination and limitations.

- `UserEvidenceProvider`: explicitly selected or imported observations. Imports cannot impersonate official API provenance. About fields are labeled **USER-CAPTURED X DISPLAY**.
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
