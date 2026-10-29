# Provider service

Run `npm run adapter` from the repository with `CF_EXTENSION_ORIGINS` set to the unpacked extension's `chrome-extension://` origin. It binds only to 127.0.0.1:8787. `CF_PORT` selects another port. Use the same origin and port in the panel.

Optional environment variables: `X_API_BEARER_TOKEN`, `XAI_API_KEY`, `XAI_MODEL`, `CF_PUBLIC_HOSTS`. Never place provider credentials in extension storage or distributable files. No credential is required for the built-in NASA and Wikipedia public-source adapters. Add only hosts you are authorized to retrieve.

`POST /provider` accepts six explicit operations: capabilities, account, posts, post, sources, enrich. Its closed request schema rejects other operations. The service checks the Host and extension Origin on every request; CORS is not wildcarded. Browser X sessions are never accessed.

X requests use documented endpoints at api.x.com/2. This implementation does not expose About fields, archive search or general Community Notes. They remain unavailable even if the account profile has a `location` value.

Each action has a bounded request budget, 15-second outbound timeout, response-size cap, one server-error retry and a five-minute in-memory JSON cache. No auth/rate-limit retry, browser impersonation or hidden fallback exists. The service is read-only except for an explicit optional xAI inference request. It does not write provider data or keys to disk.

Sources: [X user lookup](https://docs.x.com/x-api/users/lookup/introduction), [X timelines](https://docs.x.com/x-api/posts/timelines/introduction), [X post search](https://docs.x.com/x-api/posts/search/introduction), [xAI Responses](https://docs.x.ai/developers/tools/x-search). API access and entitlements must be verified in the operator's account.
