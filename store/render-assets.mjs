// Renders Chrome Web Store assets at exact sizes from demo screenshots (DEMO DATA) with headless Chrome.
// Usage: PUPPETEER_CORE=<path> node store/render-assets.mjs  (expects /tmp/cf-store with fonts, demo PNGs, icon512.png)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'puppeteer-core');
const D = '/tmp/cf-store/', OUT = 'store/assets/';
const css = `@font-face{font-family:A;src:url(Archivo-Variable-latin.woff2);font-weight:100 900;font-stretch:62% 125%}
@font-face{font-family:M;src:url(JetBrainsMono-Variable-latin.woff2);font-weight:400 800}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0b0b0d;color:#fff;font-family:A,sans-serif}
.hz{position:absolute;left:0;right:0;top:0;height:14px;background:repeating-linear-gradient(-45deg,#faf905 0 10px,#0b0b0d 10px 20px)}
.lbl{font:700 14px/18px M,monospace;letter-spacing:.04em;text-transform:uppercase;color:#9a9aa3}
.disp{font-weight:800;font-stretch:125%;text-transform:uppercase;letter-spacing:-.01em;line-height:.98;color:#faf905;margin:0}
.reg{position:absolute;inset:0;pointer-events:none;background:
linear-gradient(#faf905,#faf905) top left/18px 3px no-repeat,linear-gradient(#faf905,#faf905) top left/3px 18px no-repeat,
linear-gradient(#faf905,#faf905) top right/18px 3px no-repeat,linear-gradient(#faf905,#faf905) top right/3px 18px no-repeat,
linear-gradient(#faf905,#faf905) bottom left/18px 3px no-repeat,linear-gradient(#faf905,#faf905) bottom left/3px 18px no-repeat,
linear-gradient(#faf905,#faf905) bottom right/18px 3px no-repeat,linear-gradient(#faf905,#faf905) bottom right/3px 18px no-repeat}`;
const shots = [
  ['01-timeline-dark.png', 'Badges show where X reports each account is based', 'Flags, VPN/proxy hints, highlights you choose'],
  ['02-popover-vpn-dark.png', 'Click a badge for the full provenance spread', 'Based in · Connected via · X\u2019s location note · sources'],
  ['04-mismatch-us-eu-topics-dark.png', 'Topic/location mismatch, labeled inferred', 'A signal, not proof'],
  ['06-panel-overview-mismatch.png', 'Local side-panel workspace', 'Evidence labels: reported · self-described · corroborated · inferred · unknown'],
  ['01b-timeline-light.png', 'Works on X light and dark themes', 'No server · no AI API · data stays in your browser']
];
const pages = [];
shots.forEach(([img, h, sub], i) => pages.push([`screenshot-${i + 1}-1280x800.png`, 1280, 800, `<div class="hz"></div>
<div style="position:absolute;left:56px;top:70px;width:470px"><div class="lbl">Chud Finder · demo data</div>
<h1 class="disp" style="font-size:44px;margin-top:18px">${h}</h1><p style="font:600 20px/28px A;color:#fff;margin-top:22px">${sub}</p>
<p class="lbl" style="position:absolute;top:620px;width:470px;font-size:12px">Fictional accounts. Not a capture of live X. Location is context, never proof a post is true or false.</p></div>
<div style="position:absolute;left:570px;top:44px;width:670px;height:716px;display:flex;align-items:center;justify-content:center;border:1px solid #6a6a72;background:#16161a">
<div class="reg"></div><img src="${img}" style="max-width:640px;max-height:690px;display:block"></div>`]));
pages.push(['promo-small-440x280.png', 440, 280, `<div class="hz" style="height:10px"></div><img src="icon512.png" style="position:absolute;left:28px;top:56px;width:120px;height:120px">
<div style="position:absolute;left:168px;top:50px;right:20px"><h1 class="disp" style="font-size:34px">Chud<br>Finder</h1><p class="lbl" style="font-size:11px;margin-top:12px;color:#fff">Know where your information is coming from</p></div>
<p class="lbl" style="position:absolute;left:28px;bottom:14px;font-size:10px">Location is a signal, not proof</p>`]);
pages.push(['marquee-1400x560.png', 1400, 560, `<div class="hz"></div><img src="icon512.png" style="position:absolute;left:90px;top:110px;width:340px;height:340px">
<div style="position:absolute;left:500px;top:110px;right:80px"><div class="lbl">Chud Finder for X · Chrome / Brave</div>
<h1 class="disp" style="font-size:58px;margin-top:20px">Know where your information is coming from</h1>
<p style="font:700 24px/32px A;margin-top:26px">Confirm the source. Some accounts aren\u2019t where they say they are.</p>
<p class="lbl" style="margin-top:22px">Location is a signal, not proof</p></div>`]);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
const page = await browser.newPage();
for (const [name, w, h, body] of pages) {
  writeFileSync(D + 'p.html', `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto('file://' + D + 'p.html', { waitUntil: 'load' }); await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 200));
  await page.screenshot({ path: OUT + name, clip: { x: 0, y: 0, width: w, height: h } }); console.log('wrote', name);
}
await browser.close();
