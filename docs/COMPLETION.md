# Chud Finder 3.1 completion report

This update adds working offline C2PA validation, live Commons exact-file lookup, source-passage discovery and reviewed corroboration strength. It fixes timestamp ordering across UTC offsets and preserves collected sources/media when refreshing. The existing extension design, five tabs and deterministic core remain intact.

Branch: `feat/authorized-evidence-story`. Previous implementation: `0bb4a8f`. The delivered report records the new commit after publication. This remains a candidate with the live-access limits below.

## What now works

- **Content Credentials:** the installed extension sends a selected file only to the loopback adapter. The native SDK separately reports signature validity, asset binding and signer trust. Actual tests cover signed, altered and unsigned files. The signed SDK fixture validates cryptographically while its test certificate remains untrusted.
- **Media instances:** Commons lookup sends a SHA-1 fingerprint and verifies returned hashes. A live lookup found Example.jpg and its recorded upload timestamp, `2010-03-14T17:20:20Z`. That is a repository upload date, not the event date or proof of first publication. Google Vision web matching is implemented behind a separate explicit paid control and server key; returned pages have unknown dates.
- **Metadata:** local EXIF extraction retains date/software fields and excludes camera, artist and GPS identifiers. Editable metadata never becomes a verified event date. File hashes and the existing perceptual image/keyframe comparisons remain inspectable.
- **Quotes and corroboration:** passage discovery searches retrieved source text and shows context. Three bars require matching dated direct passages, distinct user-reviewed origin groups and no recorded shared citations/hosts or conflicting scoped comparisons. Reviews are labeled user judgments; this is conditional strength for a narrow comparison, not a truth probability. Imports cannot claim verified C2PA or independently retrieved source provenance.
- **Continuity:** refresh retains sources, comparisons and media with their original observation times. UTC offsets are compared as instants rather than strings.

## Evidence and reproduction

Measured result: **89 automated tests passed**: 55 Node, 16 legacy settings, 17 legacy pure-function and one Python test. Build and typecheck passed. Two sequential builds produced identical archive hashes. [Test log](verification-v3.1/tests-v3.1-final.log), [typecheck](verification-v3.1/typecheck-v3.1-final.log), [build](verification-v3.1/build-v3.1-final.log), [package/environment record](verification-v3.1/release-validation.json).

**Twelve Brave acceptance checks passed** against the installed extension and actual adapter: live NASA retrieval, passage discovery/comparison, seven stages, version history, receipt exports, pointer/keyboard graph inspection, native C2PA validation, live Commons retrieval and refresh retention. [Browser results](acceptance-v3.1/browser-acceptance.json), [browser log](verification-v3.1/browser-v3.1-final.log), [media investigation](acceptance-v3.1/media-investigation.json), [NASA investigation](acceptance-v3.1/live-investigation.json), [receipt](acceptance-v3.1/live-receipt.json).

The media review uses a separate test workspace, not an attribution to NASA or any X account. The signed/unsigned CAI fixtures and tampering check are documented in `test/fixtures/media/README.md`. The separate synthetic propagation dataset still computes the mandate's example counts and is never presented as live account evidence. [Synthetic records](acceptance-v3.1/synthetic-input.json).

Screenshots: [Content Credentials and live Commons result](acceptance-v3.1/media-verification.png), [NASA overview](acceptance-v3.1/live-overview.png), [dated comparison](acceptance-v3.1/live-claim-verification.png), [synthetic graph](acceptance-v3.1/synthetic-graph.png).

The first expanded browser run passed the new media checks but timed out after importing the synthetic fixture while still on the Claims tab. The harness now selects Overview before asserting narrative counts. [Retained failed run](verification-v3.1/history/browser-v3.1-first.log). Native-worker argument and offset-ordering failures found during development were fixed and are covered by the final tests.

Reproduce with `npm ci`, `npm run typecheck`, `npm test`, `npm run build` and `npm run test:browser`. The browser test clears paid-provider keys in its own process, uses a temporary Brave profile and requires public access to NASA and Commons. Set `BRAVE_PATH` when necessary. The source README documents the loopback adapter setup and exact supported Node versions.

## Remaining access and interpretation limits

Approved live X API access remains unavailable; no real X timeline or propagation dataset was collected. The local Grokbot installation was located, but no documented inference service suitable for reuse was established. No credentials were extracted. Live Grok and Google Vision calls were not made and no paid-provider credits were used.

General Community Notes retrieval and hosted permalinks remain unavailable. Broad semantic claims stay unverified when the deterministic comparison cannot establish them. Commons search is limited to exact bytes in that repository. C2PA checks are offline, with remote manifests and online revocation checks disabled; valid signatures do not authenticate depicted events. Source independence remains an explicit user review, not an automated determination. Store approval and the legacy icon's licensing were not established.

Temporary browser profiles remain because the earlier cleanup command was blocked by automatic approval review. No task-owned dev server or browser process was active at the final process check.

## Install

Unzip the extension package, open `brave://extensions`, enable Developer mode and choose **Load unpacked**. Public retrieval and C2PA checks require the source adapter: run `npm ci`, set `CF_EXTENSION_ORIGINS` to the extension origin and run `npm run adapter`. Connect the panel to `http://127.0.0.1:8787`. API keys stay in the service; free NASA/Commons/C2PA checks do not need one.
