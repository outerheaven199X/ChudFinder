# Chud Finder 3.3.1

The toolbar icon now opens the full investigation panel directly. Auto/Careful and its hover/focus/click (?) help sit at the top of that panel. The tiny popup and lower-left mode control on X have been removed. Enabled, cache clearing and settings remain accessible in the panel; flags still open the selected investigation.

The change removes the manifest popup route and uses Chrome's documented [toolbar-to-side-panel behavior](https://developer.chrome.com/docs/extensions/reference/api/sidePanel#open_the_side_panel_by_clicking_the_toolbar_icon). Passive capture, existing observations and the explicit Auto opt-in are preserved. No new permissions or paid calls were added.

## Validation

The built-script tests cover the toolbar configuration, absence of packaged popup files and page-mounted mode controls, panel/settings synchronization, hover and keyboard help, and the panel's Careful selection stopping new background lookup requests. The panel controls also work before an investigation exists. These tests simulate Chrome APIs and do not prove a native toolbar click.

The panel was rendered in Brave at a 420-pixel viewport using the actual built HTML, CSS and JavaScript with example investigation data and simulated extension storage. Auto/Careful changes and risk-help hover/Escape were checked. This preview is separate from the installed extension and made no X requests.

Full `npm test` encountered a native C2PA media-test process crash (Windows exit code 3221225477 / 0xC0000005). It reproduced when that test ran alone under Node 24.22.1 and the bundled Node 24.19.0. The media implementation is unchanged by this patch. The failed runs are retained in [validation artifacts](validation-3.3.1/); the full suite is not claimed green. The [run excluding that native test](validation-3.3.1/tests-excluding-native-c2pa.log) passed 72 Node tests, 16 legacy settings checks, 17 legacy display checks and one Python test: 106 calculated passing checks, with one native test excluded. [Typecheck](validation-3.3.1/typecheck.log) passed.

The user confirmed that clicking a flag opened the installed 3.3.0 panel. Installed 3.3.1 toolbar behavior requires an extension reload and user verification because automatic approval review blocks agent access to extension-management and extension pages. No native 3.3.1 acceptance is claimed here.
