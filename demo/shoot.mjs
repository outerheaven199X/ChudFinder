// Render the demo timeline with the REAL built content script in headless Chrome. Demo data only.
// Usage: npm run build && PUPPETEER_CORE=<path to puppeteer-core> node demo/shoot.mjs
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
const W = '/tmp/cf-demo', OUT = 'docs/screenshots';
mkdirSync(W, { recursive: true }); mkdirSync(OUT, { recursive: true });
for (const f of readdirSync('dist/fonts')) cpSync('dist/fonts/' + f, W + '/' + f);
cpSync('dist/src/content.js', W + '/content.js');
writeFileSync(W + '/content.css', readFileSync('dist/src/content.css', 'utf8').split('chrome-extension://__MSG_@@extension_id__/fonts/').join('./'));
for (const f of ['seed.js', 'timeline.html']) cpSync('demo/' + f, W + '/' + f);
execSync('npx esbuild demo/panel-harness.ts --bundle --format=iife --outfile=' + W + '/panel.js --log-level=warning');
const style = /<style>[\s\S]*?<\/style>/.exec(readFileSync('dist/src/sidepanel.html', 'utf8'))[0].split('../fonts/').join('./');
writeFileSync(W + '/panel.html', '<!doctype html><html><head><meta charset="utf-8">' + style + '</head><body><header><div class="bar"><span class="brand mono">CHUD FINDER</span><button class="btn small">Refresh</button><button class="btn small">Delete</button></div><div class="bar" style="margin-top:6px"><select><option>@demo_borderdesk · v1</option></select><select><option>v1</option></select></div><nav id="tabs"></nav><div class="status mono">demo data · fictional account</div></header><main id="main"></main><script src="panel.js"></script></body></html>');
const srv = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1', '-d', W], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
const base = 'http://127.0.0.1:8765/';
async function timeline(theme, w = 640, h = 1000) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(base + 'timeline.html#' + theme, { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('[data-cf-badge]:not(.cf-pending)').length >= 7, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 400));
}
async function pop(handle, name, clipH = 620) {
  await page.evaluate(h => document.querySelector('[data-cf-for="' + h + '"]').click(), handle);
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: OUT + '/' + name + '.png', clip: { x: 0, y: 0, width: 640, height: Math.min(1000, await page.evaluate(() => Math.ceil(document.querySelector('.cf-pop').getBoundingClientRect().bottom + 16))) } });
  console.log('wrote', name);
}
await timeline('dark');
await page.screenshot({ path: OUT + '/01-timeline-dark.png', fullPage: true }); console.log('wrote 01-timeline-dark');
await pop('demo_relaynode', '02-popover-vpn-dark');
await timeline('dark'); await pop('demo_borderdesk', '04-mismatch-us-eu-topics-dark', 640);
await timeline('light');
await page.screenshot({ path: OUT + '/01b-timeline-light.png', fullPage: true }); console.log('wrote 01b-timeline-light');
await pop('demo_relaynode', '03-popover-vpn-light');
await timeline('light'); await pop('demo_statehouse', '05-mismatch-domestic-india-topic-light', 560);
for (const t of ['Overview', 'Origin']) {
  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 1 });
  await page.goto(base + 'panel.html#' + t, { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' }); await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: OUT + '/06-panel-' + t.toLowerCase() + '-mismatch.png', fullPage: true }); console.log('wrote panel', t);
}
await browser.close(); srv.kill();
