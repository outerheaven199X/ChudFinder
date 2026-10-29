# Chud Finder Privacy Policy

_Last updated: October 29, 2026. Applies to Chud Finder 2.2.0 and later._

**Chud Finder does not collect, sell, or transmit your data to its developer or any third party. There is no Chud Finder server.**

## What the extension reads
- **On x.com and twitter.com only:** account handles and post text that appear on pages you view, plus the account's public *About this account* data (country X reports, how it connects, X's location-accuracy note). This data is requested from x.com in **your own logged-in session**, the same way the X website does it.
- X's own page traffic (observed in the page) to read self-reported profile locations and recent posts shown to you.

## Where data is stored
- In your browser only, via `chrome.storage.local`: settings, a lookup cache (24 h), and investigations you choose to create. You can clear the cache from the popup and delete investigations from the side panel. Uninstalling removes everything.

## Network requests the extension makes
| To | When | What is sent |
|---|---|---|
| x.com / twitter.com | While you browse X | Lookup requests in your session (same as X's own site) |
| abs.twimg.com | Occasionally | Fetches X's public web-client script files **as text** to find the current lookup query id. Nothing is executed. |
| A settings URL you enter (e.g. a GitHub Gist) | Only if you set one; at startup and every 10 min | A plain GET. Requires your permission for that origin. Read as data, never as code. |
| grok.com | Only when you click **Ask Grok** | Opens a new tab with a prompt you can see (also copied to your clipboard). Nothing is sent in the background. |

## What it never does
- No analytics, telemetry, ads, or tracking. No accounts. No AI API calls. No remote code.
- It does not sell data, transfer data for unrelated purposes, or use data for creditworthiness or lending.

## Interpretation
A location is context about where an account operates. It is never treated as proof that a post is true or false, and an account's country never makes it a bad actor.

## Contact
Open an issue: https://github.com/outerheaven199X/ChudFinder/issues
