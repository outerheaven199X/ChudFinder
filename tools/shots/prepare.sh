#!/bin/sh
# Prepare the fixture harness pages for tools/shots/shoot.mjs. Usage: sh tools/shots/prepare.sh
set -e
cd "$(dirname "$0")/../.."
OUT=verification/screenshots; mkdir -p "$OUT" /tmp/cf-shots
npx esbuild tools/shots/harness.ts --bundle --format=iife --outfile=/tmp/cf-shots/harness.js --log-level=warning
cp dist/fonts/TwemojiCountryFlags.woff2 /tmp/cf-shots/
STYLE=$(sed -n '/<style>/,/<\/style>/p' dist/src/sidepanel.html | sed 's#\.\./fonts/#./#')
cat > /tmp/cf-shots/panel.html <<HTML
<!doctype html><html><head><meta charset="utf-8">$STYLE</head><body>
<header><div class="bar"><span class="brand mono">CHUD FINDER</span><button class="btn small">Refresh</button><button class="btn small">Delete</button></div>
<div class="bar" style="margin-top:6px"><select><option>@sample_acct · v1</option></select><select><option>v1</option></select></div><nav id="tabs"></nav><div class="status mono">fixture data</div></header>
<main id="main"></main><script src="harness.js"></script></body></html>
HTML
CSS=$(sed 's#chrome-extension://__MSG_@@extension_id__/fonts/#./#' dist/src/content.css)
cat > /tmp/cf-shots/x.html <<HTML
<!doctype html><html><head><meta charset="utf-8"><style>$CSS
body{background:#000;color:#e7e9ea;font:15px -apple-system,"Segoe UI",sans-serif;margin:0;padding:20px}
.tw{border-bottom:1px solid #2f3336;padding:12px 0;width:560px}.n{font-weight:700}.h{color:#71767b}</style></head><body>
<div class="tw"><div id="row"><span class="n">Sample Account</span> <span class="h">@sample_acct · 2h</span></div><div>BREAKING: officials confirmed the bridge closure will last until 2027…</div></div>
<div class="tw" style="margin-top:260px"><div id="row2"><span class="n">Other</span> <span class="h">@other · 5h</span></div><div>Good morning from Osaka.</div></div>
<script src="harness.js"></script></body></html>
HTML
echo prepared /tmp/cf-shots
