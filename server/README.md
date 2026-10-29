# Provider service

Run `npm run adapter` from the repository with `CF_EXTENSION_ORIGINS` set to the unpacked extension's `chrome-extension://` origin. It binds only to 127.0.0.1:8787. `CF_PORT` selects another port. Use the same origin and port in the panel.

Optional environment variables: `X_API_BEARER_TOKEN`, `XAI_API_KEY`, `XAI_MODEL`, `GOOGLE_VISION_API_KEY`, `CF_PUBLIC_HOSTS`. Never place provider credentials in extension storage or distributable files. No credential is required for NASA, Wikipedia, Commons or local C2PA checks. Add only hosts you are authorized to retrieve.

`POST /provider` accepts explicit operations: capabilities, account, posts, post, sources, enrich, media-search and verify-media. Its closed request schema rejects other operations. The service checks the Host and extension Origin on every request; CORS is not wildcarded. Browser X sessions are never accessed.

X requests use documented endpoints at api.x.com/2. This implementation does not expose About fields, archive search or general Community Notes. They remain unavailable even if the account profile has a `location` value.

Each action has a bounded request budget, 15-second outbound timeout, response-size cap, one server-error retry and a five-minute in-memory JSON cache. No auth/rate-limit retry, browser impersonation or hidden fallback exists. The service is read-only except for explicit optional xAI or Google Vision processing requests. It does not write provider data or keys to disk.

Sources: [X user lookup](https://docs.x.com/x-api/users/lookup/introduction), [X timelines](https://docs.x.com/x-api/posts/timelines/introduction), [X post search](https://docs.x.com/x-api/posts/search/introduction), [xAI Responses](https://docs.x.ai/developers/tools/x-search). API access and entitlements must be verified in the operator's account.

## Media and review boundaries

The media verifier uses pinned `@contentauth/c2pa-node` 0.9.11. Inputs are byte buffers, never server paths. Files are limited to 16 MB; parsing runs in a worker with a deadline. Remote manifests and OCSP network access are disabled. Signature validity, asset binding and certificate trust are stored separately; missing or unreadable manifests remain unverified. Only loopback adapter URLs can receive selected file bytes from the extension.

Commons exact-byte lookup uses the public Allimages API and checks every returned SHA-1. Its timestamps describe repository uploads, not depicted events. Google Vision web detection requires `GOOGLE_VISION_API_KEY`; it sends one selected public image URL, rejects private/nonstandard-port destinations and returns undated candidate pages. No paid live Google request has been run.

Optional xAI enrichment requires both `XAI_API_KEY` and an explicit currently available `XAI_MODEL`. No model name or price is assumed. The local Grokbot installation was located, but no documented inference interface suitable for this adapter was established; its credentials are not extracted.

Primary references: [CAI Node SDK](https://contentauth.github.io/c2pa-js/node/), [C2PA verification settings](https://docs.rs/c2pa/latest/c2pa/settings/struct.Verify.html), [Commons Allimages API](https://www.mediawiki.org/wiki/API:Allimages), [Google Vision web detection](https://docs.cloud.google.com/vision/docs/detecting-web), [EXIF reader](https://github.com/MikeKovarik/exifr).
