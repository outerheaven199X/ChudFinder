# Chud Finder: bot tools

These files let a bot (for example Grok Bot) answer "where is @someone based?" and manage your
Chud Finder settings for you.

| File | What it is |
|---|---|
| `lookup.py` | Command-line lookup of X's "About this account" data for one handle |
| `SKILL.md` | Instructions for the bot: look up accounts, update your settings gist, hand out a settings code |
| `test_lookup.py` | Offline tests: `python3 bot/test_lookup.py` (runs against a fake local server) |

## lookup.py

```
python3 bot/lookup.py @jack --cookies ~/x-cookies.json
# or
X_AUTH_TOKEN=... X_CT0=... python3 bot/lookup.py jack
```

Output:

```json
{"handle": "jack", "based_in": "United States", "location_accurate": true,
 "source": "United States App Store", "self_reported_location": null}
```

- `based_in`: X's "Account based in" (a country, or sometimes a region such as "South Asia").
- `location_accurate`: `false` when X notes the location may not be accurate, for example because of a VPN or
  proxy. That is X's estimate, not proof of a VPN. `null` means X didn't say.
- `source`: the "Connected via" app-store region, e.g. `"Japan App Store"`, `"India Android App"`, `"Web"`.
- `self_reported_location`: the free-text profile location. It is only filled in when X includes it in this
  response; otherwise it's `null`. It is self-reported, so treat it as weak evidence.
- On error it prints `{"handle", "error"}` and exits 1 (usage or auth), 2 (HTTP or network) or 3 (rate limited).

**Cookies.** You need your own logged-in X session's `auth_token` and `ct0` cookies. You can find them in
DevTools → Application → Cookies → https://x.com, or export them with a cookies.txt exporter. `--cookies`
accepts any of:
- `{"auth_token":"…","ct0":"…"}`
- a JSON list of `{name, value}` cookie objects
- a Netscape `cookies.txt` file
- a raw `Cookie:` header

You can also set the `X_AUTH_TOKEN`/`X_CT0` or `X_COOKIES_FILE` environment variables instead.
**These cookies are your full X login.** Keep the file private (`chmod 600`), never paste them into a chat
or commit them, and log out of X to invalidate them if they leak.

**How it works.** It sends `GET https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery?variables={"screenName":"…"}`
with X's public web bearer token, `x-csrf-token: <ct0>` and your cookies. This is the same request the
x.com "About this account" page makes. If X rotates the query id you'll get HTTP 400/404; pass a new one with
`--query-id` or the `CF_QUERY_ID` environment variable. It uses the Python standard library only and talks to nothing but x.com.

## Settings sync

See `../SETTINGS_SCHEMA.md` for the format. In short: the bot keeps a JSON file in a GitHub Gist, and you
paste the gist's raw URL into Chud Finder → Settings → *Sync with Grok Bot*. The extension re-reads it every
10 minutes. You can also just ask the bot for a settings code and paste that in.
