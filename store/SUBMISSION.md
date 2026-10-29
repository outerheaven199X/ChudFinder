# Chrome Web Store submission checklist (Chud Finder 2.2.0)

Package: `chud-finder-cws-2.2.0.zip` (dist only; no tests, demo, or sourcemaps; `manifest.json` at root).

1. **Register** at https://chrome.google.com/webstore/devconsole. There's a one-time US$5 developer fee. Verify your contact email.
2. **New item:** upload `chud-finder-cws-2.2.0.zip`.
3. **Store listing tab:** paste from `store/listing.md` (description, category Tools, language English).
   - Icon: `store/assets/store-icon-128.png`
   - Screenshots (1280×800): `store/assets/screenshot-1…5-1280x800.png` (demo data)
   - Small promo tile: `store/assets/promo-small-440x280.png`
   - Marquee: `store/assets/marquee-1400x560.png` (optional)
   - Homepage / support URL: https://github.com/outerheaven199X/ChudFinder
4. **Privacy practices tab:**
   - Single purpose and permission justifications: `store/permission-justifications.md`
   - Remote code: **No**
   - Data usage: `store/data-usage-disclosures.md`
   - Privacy policy URL: https://github.com/outerheaven199X/ChudFinder/blob/main/docs/privacy.md
5. **Distribution:** choose visibility (start with **Unlisted** for a soft launch, or Public) and regions.
6. **Submit for review.** Expect extra scrutiny (see risks below). Reply to reviewer questions from the same docs.

## Review risks (read before submitting)
- **X internal API + embedded web-client bearer token.** The extension calls X's undocumented GraphQL `AboutAccountQuery` with the public bearer token that X's web client embeds for every user, plus the user's session cookie/CSRF header. This is how X's own site works, but it's an **unofficial use of X's internal API and may conflict with X's Terms of Service / developer policy**. CWS reviewers may question it, and X may break or block it at any time.
- **Fetching X's JS bundles from abs.twimg.com** (as text, to find the query id). This is not remote code execution, but a reviewer may ask about it. The justification is in permission-justifications.md.
- **Broad optional host permission `https://*/*`** for the user-chosen settings URL. It's optional and per-origin at runtime. A reviewer may still ask to narrow it (e.g. to `https://gist.githubusercontent.com/*`).
- **Name and icon.** "Chud" is slang a reviewer could read as derogatory, and the icon is a widely circulated meme with **unclear provenance/licensing**. Either could trigger a policy or IP question. Have a fallback name/icon ready.
- **Sensitive subject matter.** Country/location labels for accounts. The listing and UI stay neutral ("a signal, not proof"; no nationality inference), which matters for the hate/harassment policies.
- **Not yet verified on live X.** Test the packaged zip on live X before submitting so reviewers don't see broken functionality.
