# Chud Finder 3.2.1

Installing now activates flags on X tabs that are already open. The previous build only started on newly loaded documents, leaving existing tabs empty or running stale badge code until a manual page refresh. Auto remains the fresh-install default. Opening the popup or an investigation is not part of flag activation; clicking a flag still selects that account for investigation.

The install/update/startup handler activates only X/Twitter documents, checks whether the current version is already running, and injects the packaged content script and CSS when needed. Repeated activation does not duplicate badges or listeners. Legacy tabs refresh once to clear scripts that cannot dispose themselves; tabs with unsent text are left alone until their next navigation. Existing user settings are retained.

This uses Chrome's documented [scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) and [installation event](https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onInstalled). The manifest adds `scripting` and explicit host permissions for the same X/Twitter HTTPS pages already covered by its content scripts. It adds no access to other sites.

`npm run typecheck` and `npm test` passed. The [test log](validation-3.2.1/npm-test.log) reports 70 Node tests, 16 legacy settings checks, 17 legacy display checks and one Python test, totaling 104 checks by addition. The new installation test runs the built background and content scripts with an already-open X document and empty storage. It reaches the country badge without a popup, click or page reload. It also checks repeated injection, script replacement, preference retention, draft preservation, origin restrictions and isolation of a closed tab. Browser installation, permissions and tab APIs are simulated in these tests.

Live 3.2.0 country acquisition and Auto/Careful behavior were observed in the user's installed browser after manually reloading X. The new 3.2.1 installation event has not yet been verified in that browser. Automatic approval review prevents the agent from operating extension management, so the new build still needs one manual extension reload for installed acceptance. No additional paid-provider actions were performed.

An initial run of the new installation harness omitted the browser global `URLSearchParams` and failed before injection. Adding that global to the simulated service-worker environment corrected the harness; the complete rerun passed. This was a harness failure, not live installation evidence.
