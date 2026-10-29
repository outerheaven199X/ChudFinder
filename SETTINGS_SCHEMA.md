# Chud Finder settings document — schemaVersion 1

Chud Finder can take its settings from three places, which all use this one JSON format:

1. **Settings source URL** (Settings → *Sync with Grok Bot*): an `https://` URL, typically a raw
   GitHub Gist file the bot maintains. The extension fetches it on browser startup, when you save the URL,
   and every 10 minutes (`chrome.alarms`).
2. **Settings code**: the same JSON, base64-encoded (UTF-8). Paste it into *Settings code → Apply code*.
   You can paste raw JSON there too.
3. **Export settings code** produces a code from your current settings.

## Example

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "showName": true,
  "askGrok": true,
  "popover": true,
  "grokBotTemplateUrl": "",
  "vpnWarnings": true,
  "mismatchWarnings": true,
  "topicMode": true,
  "homeCountry": "US",
  "highlightCountries": ["CA", "Mexico"],
  "updatedAt": "2026-10-29T12:00:00Z",
  "note": "set by Grok Bot"
}
```

The matching code is `btoa(JSON.stringify(doc))`, i.e. `base64.b64encode(json.dumps(doc).encode()).decode()` in Python.

## Fields

| Key | Type | Required | Meaning |
|---|---|---|---|
| `schemaVersion` | integer, must be `1` | **yes** | Format version. Any other value is rejected. |
| `enabled` | boolean | no | Turn badges on or off. |
| `showName` | boolean | no | Show the country name next to the flag. |
| `askGrok` | boolean | no | Clicking a badge opens Grok (grok.com) with a prefilled prompt about that account, and copies the prompt. Default `true`; `false` makes badges plain (no click handler). |
| `vpnWarnings` | boolean | no | Warn when X says the location may not be accurate (VPN/proxy). |
| `mismatchWarnings` | boolean | no | Warn when the self-reported location or app-store region differs from "based in". |
| `topicMode` | boolean | no | Outline accounts based outside `homeCountry`. |
| `homeCountry` | string | no | ISO 3166-1 alpha-2 code (`"US"`) or an English country name (`"United States"`). |
| `highlightCountries` | array of strings, ≤ 300 | no | ISO codes or English names. Duplicates are removed and the list is stored as ISO codes. `[]` clears it. |
| `updatedAt`, `note` | any | no | For humans and bots. Accepted and ignored. |

## Rules

- **Strict:** if any known key has the wrong type, or there's an unknown country or a bad
  `schemaVersion`, the **whole document is rejected** and nothing changes. The error shows in the popup and on the Settings page.
- **Unknown keys are ignored.** They show as a warning, not an error, so newer documents still load in older versions.
- **Partial updates:** keys you leave out keep their current values. Only the keys in the document change.
- **Remote URL updates apply when the content changes.** The extension keeps a SHA-256 of the last document it applied. If
  you change a setting locally, your change stays until the bot publishes a different document.
- **Limits:** the document must be 64 KB or less, `https:` only, and URLs with embedded credentials are refused. The extension only asks for
  permission to read the one origin you save (via `optional_host_permissions`), and asks when you click Save.
  Remove drops that permission again.
- **Data only:** the document goes through `JSON.parse` and per-field type checks. Nothing in it is evaluated,
  executed, injected into pages, or used to build URLs.

## Added in 2.0.0 (still schemaVersion 1; both optional)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `popover` | boolean | `true` | Clicking a badge opens the provenance popover (Investigate / Ask Grok). `false` restores the 1.2.0 behaviour (click = Ask Grok). |
| `grokBotTemplateUrl` | https URL or `""` | `""` | Link shown as "Deep investigation with Chud Finder Grok Bot" in the side panel. Empty hides it; non-https values are rejected. |

Validate a document exactly as the extension does: `npm run build && node tools/validate-settings.cjs < settings.json`.
