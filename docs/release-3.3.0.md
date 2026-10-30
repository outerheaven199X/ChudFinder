# Chud Finder 3.3.0

Careful mode now captures About pages the user opens, and becomes the install/upgrade default. Saved flags still appear automatically. Unknown accounts get a normal **About ↗** link; opening it saves X's displayed country without manual entry and updates flags across open tabs. Clicking a flag still opens the investigation. Auto background lookups remain optional and require an explicit selection in the local mode control.

Unlike 3.2.1, Careful makes no background X visits on load, scroll, hover, focus, investigation click or refresh. Enforcement occurs in the service worker as well as the content UI. Old settings and imported/synced mode values cannot grant the new local background opt-in. Returning to Careful revokes it and cancels queued jobs; a visit already running may finish. Saved observations retain their dates and remain visible without background refresh. The investigation includes a normal Open X About link for updates.

This removes Chud Finder's extra automated visits in the default mode. It is not a guarantee against account restrictions. The [policy research](lookup-risk.md) distinguishes passive observation from the extra visits in optional Auto. No new provider, paid request, credential access or browser permission was added.

## Validation

The [test log](validation-3.3.0/npm-test.log) reports 73 Node tests, 16 legacy settings checks, 17 legacy display checks and one Python test. Calculated total: 107. [Typecheck](validation-3.3.0/typecheck.log) passed.

Built-script tests simulate fresh installation, hovering, scrolling and clicking without creating background X tabs, then a user-opened About page that updates both existing and future feed tabs. They check retained expired observations, recycled authors, duplicate injection, opt-in migration, imported settings, queued-job cancellation and optional Auto acquisition. Chrome APIs and navigation are simulated; the About markup is the previously captured 0xReso fixture. X's South Asia region is preserved without substituting India from profile location.

The UI was also rendered in Brave on an isolated localhost fixture with simulated extension storage. Saved and unknown accounts, About link destinations, mode switching and keyboard help were checked. Bundled font URLs were mapped to the local fixture server. This is UI evidence, not installed-extension acceptance. The actual 3.3.0 extension still requires the user's reload because automatic approval review blocks agent access to extension management. Investigation panel contents remain unverified in that installed context.

The [initial test log](validation-3.3.0/npm-test-initial.log) retains two failures from assertions for the previous Careful behavior (hover lookup and its old badge symbol). Updating those expectations to the new passive contract made the suite pass. The [initial typecheck](validation-3.3.0/typecheck-initial.log) retains a test-harness narrowing error after an assertion that a cache entry was absent. Re-reading that entry after capture resolved the error; the final typecheck passed.
