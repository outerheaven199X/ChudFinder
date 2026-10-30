# Chud Finder 3.2.0

Country badges now acquire X About data automatically. Auto reads visible accounts; Careful waits for hover or click. Clicking a badge saves the visible profile/post data and opens the investigation without waiting for an optional API provider. About results update the badge and the open investigation as they arrive. No manual country entry or paid API call is required for this flow.

The previous release rendered stored country observations but did not acquire them. Its mode control did not drive a lookup, and the panel subscribed to storage updates too late during startup. This release adds a paced About-page reader and subscribes to investigation updates before initialization awaits. Updates for other accounts preserve the active investigation.

## Validation

`npm run typecheck` and `npm test` passed on Windows with Node 24.22.1. The test command reports 68 Node tests, 16 legacy settings checks, 17 legacy display checks, and one Python test: 102 checks in total, calculated from those reported counts. See [test output](validation-3.2.0/npm-test.log), [initial failed run](validation-3.2.0/npm-test-initial-failed.log), and [flow evidence](validation-3.2.0/built-flow-evidence.json).

The new integration test runs the built content, About worker, background and panel scripts together with simulated Chrome storage/messages/tabs. It starts without country data, clicks during acquisition, checks profile/post data in the panel, then checks the asynchronous region and warning. It also covers Careful mode, cache reuse, sender/subject validation, lookup errors, daily limits and an initial-storage-read race. Browser tab creation and navigation remain simulated in this test.

The regression fixture contains [rendered About rows captured from @0xReso](../test/fixtures/0xReso-about.json). X displayed **South Asia**, **South Asia App Store**, and **Country or region may not be accurate**. The profile separately displayed **New Delhi, India**. The About result therefore receives a region globe, not an India operating-country flag. The India flag assertion substitutes a country into the captured row structure and is explicitly a fixture case.

The first full run failed a fixed-delay DOM assertion and the native media-test subprocess exited without a diagnostic. The DOM assertion now waits for its expected state. The media tests passed independently and the complete rerun passed; the initial native-process exit remains unexplained. Both full-run logs are retained.

## Installed-browser boundary

The package was copied into the existing Desktop extension folder and all packaged files were hash-compared. The installed Brave extension still needs a manual reload. Automatic approval review rejected access to extension-management pages, so installed 3.2.0 navigation, native side-panel opening and real background-tab completion have **not yet been accepted**. Live X source inspection and the simulated integration test do not establish those outcomes. `npm run test:browser` was not run for this repair because its extension-page automation would cross that same restriction.

## Behavior and limits

Country lookup opens one temporary inactive X tab at a time using the browser's normal session. It does not extract credentials, intercept requests or call internal endpoints. Lookups start at most ten times per minute, default to 300 per local day, and cache countries for 24 hours. Login/access prompts pause the queue. English About labels are supported; unsupported markup or a page that fails to load produces a visible error. Source time and X accuracy warnings remain attached to the observation.

No additional X, xAI or Google API spending was performed for this repair. Larger post samples and external searches remain separate optional provider actions. The earlier paid audit is unchanged.

Reproduce with `npm ci`, `npm run typecheck`, and `npm test`. To save the simulated flow's detailed record, set `CF_FLOW_EVIDENCE_DIR` to an output directory and run `node --test test/country-flow.test.ts` after building. For installation, reload the existing unpacked extension and X tabs; Auto/Careful is visible directly on X and in the popup/settings.
