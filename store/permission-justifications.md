# Permission justifications

**Single purpose:** Investigate explicitly selected public claims using cited evidence, authorized providers and a local reporting workspace.

| Permission | Purpose |
|---|---|
| `storage` | Stores settings, provider connection preferences and versioned investigation evidence locally. API credentials are never stored in the extension. |
| `alarms` | Checks an optional user-configured HTTPS settings file every ten minutes. It does not schedule account investigations. |
| `sidePanel` | Opens the existing investigation workspace after a user action. |
| X/Twitter content-script matches | Displays cached country flags and selection controls, captures visible About pages the user opens in default Careful mode, and records selected public post/profile observations. Explicit optional Auto reads rendered About pages in a temporary background tab. |
| `scripting` and X/Twitter host permissions | Activates the packaged content UI on already-open X/Twitter tabs at install/update/startup. No other origins are inspected. |
| Optional `https://*/*` | Requests a specific origin when the user configures a remote provider adapter or settings URL. The extension never requests a wildcard grant. Local loopback requests use the adapter's restricted CORS policy. |

Default host permissions cover only X/Twitter. No cookie access, webRequest, debugger, browsing-history or clipboard-read permissions. No remote executable code; fetched settings and source material are treated as data. See [actual data flows](data-usage-disclosures.md) and [privacy policy](privacy-policy.md).
