# Permission justifications

**Single purpose:** Investigate explicitly selected public claims using cited evidence, authorized providers and a local reporting workspace.

| Permission | Purpose |
|---|---|
| `storage` | Stores settings, provider connection preferences and versioned investigation evidence locally. API credentials are never stored in the extension. |
| `alarms` | Checks an optional user-configured HTTPS settings file every ten minutes. It does not schedule account investigations. |
| `sidePanel` | Opens the existing investigation workspace after a user action. |
| X/Twitter content-script matches | Renders account/post selection controls and reads one explicitly selected public post or profile observation. No automatic feed collection or authenticated API access. |
| Optional `https://*/*` | Requests a specific origin when the user configures a remote provider adapter or settings URL. The extension never requests a wildcard grant. Local loopback requests use the adapter's restricted CORS policy. |

No default host permissions, cookie access, webRequest, debugger, browsing-history or clipboard-read permissions. No remote executable code; fetched settings and source material are treated as data. See [actual data flows](data-usage-disclosures.md) and [privacy policy](privacy-policy.md).
