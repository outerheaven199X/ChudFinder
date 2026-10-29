# Chud Finder 3.0 completion report

The installable candidate replaces authenticated X interception with explicit source providers and runs the seven-stage evidence story without Grok. Build, typecheck, automated tests and an installed Brave investigation passed. **This is a qualified candidate, not a claim that the full mandate is production-complete.** Live X collection and several advanced verification features remain limited below.

Branch: `feat/authorized-evidence-story`. Baseline: `7e2676689c5a7b71778500ee5a7b6dcef8735575`. The delivered handoff records the implementation SHA. Existing five-tab layout, typography, design tokens, settings and versioned store were retained.

## Implemented

| Area | Result |
|---|---|
| Acquisition | Typed official X, public-source, user-evidence and optional Grok providers; credentials isolated in an origin-restricted loopback service. No cookie reads, interception, query discovery or automated feed investigation in the release bundle. |
| Seven stages | Separate platform-display fields; conservative self-location comparison; qualified UTC activity and within-account writing; deterministic clusters, topics and phrases; chronological observed propagation; cited summary. Missing data stays unavailable. |
| Integrity | Stable evidence IDs and display roles; reconstructed statistics and relationships; validated imports, dates and citations; retained corrections and prior snapshots. |
| Verification | Dated source-passage comparisons, scoped quote and organizational comparisons, ClaimReview extraction, citation dependency graph, local image/video fingerprints and supplied-date conflicts. |
| Interface and exports | Evidence/source inspection, pointer and keyboard graph interaction, UTC histogram, import/refresh/version controls, complete JSON, PNG source appendix and local thread drafts. |
| Operations | Explicit request budgets, capped caching and retries, cancellation, request/token telemetry and truthful unavailable currency costs. |

## Verification

`npm run build`, `npm run typecheck`, `npm test` and `npm run test:browser` succeeded. The measured suite counts are **48 Node tests, 16 legacy settings tests, 17 legacy pure-function tests and one Python test**. See [test log](verification/tests-final.log), [typecheck](verification/typecheck-final.log), [build](verification/build-final.log) and [package validation](verification/release-validation.json). The latter records environment versions, archive integrity, permissions and SHA-256. Two sequential builds produced the same archive hash.

The installed extension and actual adapter retrieved [NASA's Apollo 11 article](https://www.nasa.gov/history/july-20-1969-one-giant-leap-for-mankind/), preserved its publication date and text, compared the passage “The crew splashes down off Hawaii on July 24.”, generated all story sections, retained prior versions, and exported JSON, PNG and a thread draft. This establishes dated source agreement only. **No actual NASA X posts were retrieved or invented.** X search returned unavailable; live narrative counts and propagation remain unavailable. [Browser checks](acceptance/browser-acceptance.json), [stored investigation](acceptance/live-investigation.json), [receipt](acceptance/live-receipt.json), [PNG receipt](acceptance/live-receipt.png).

Separately, an explicitly synthetic dataset computes 24 account posts, a 14-post largest cluster, 20 US/EU keyword matches, nine phrase repetitions and 38 matching accounts across five hours. These are calculated fixture results, not real-account findings. [Seed records](acceptance/synthetic-input.json), [derived evidence](acceptance/synthetic-investigation.json).

Screenshots: [live overview](acceptance/live-overview.png), [live source comparison](acceptance/live-claim-verification.png), [live evidence](acceptance/live-evidence.png), [synthetic narrative](acceptance/synthetic-narrative.png), [synthetic graph](acceptance/synthetic-graph.png).

Earlier failures are retained in [history](verification/history/): the baseline Windows `python3` alias failed, initial integration assertions exposed schema/counting/import issues, and a browser graph activation check failed. The final suite uses working Python, fixes the integration failures, and verifies actual pointer plus keyboard activation. These runs are not counted as passing replicates.

## Remaining limits

- Approved live X API credentials were unavailable. Official response mapping, expired authentication, outage and rate behavior are tested with controlled responses; real timelines, recent-search entitlements and live propagation were not verified. About fields and general Community Notes are unavailable through this adapter.
- Optional Grok enrichment was not live-tested. No model call or paid X request ran. The core needs no credits; Grok funding does not supply approved X API access.
- Factual comparison is deliberately narrow. General semantic verification, automatic discovery of every original quote, and independent source adjudication are not implemented. Three-bar strength is withheld until independence can be established; source count alone cannot activate it.
- Media matching covers supplied files/keyframes and supplied dates. Internet reverse-image retrieval, EXIF event verification and C2PA signature validation are not implemented. No hosted permalink is provided.
- Brave acceptance used an isolated headless profile, not an authenticated X session. Store approval, legacy icon licensing and replacement store graphics were not established. Existing version 2 screenshots are historical.

## Install and reproduce

Unzip the delivered extension ZIP; open `brave://extensions`, enable Developer mode, and choose **Load unpacked** on the extracted folder. Use the toolbar's Investigations workspace or an explicit CF selection. User observations work without a provider.

For public sources, use the feature-branch source checkout: `npm ci`, set `CF_EXTENSION_ORIGINS` to the extension's `chrome-extension://` origin, and run `npm run adapter`. Set the panel's adapter URL to `http://127.0.0.1:8787`. Credentials are optional service environment variables; never put them in the extension. The source README documents setup and limitations. `npm run test:browser` supports `BRAVE_PATH` and `CF_EVIDENCE_DIR` overrides. Reproduction requires supported Node, Python, Brave and network access to NASA.
