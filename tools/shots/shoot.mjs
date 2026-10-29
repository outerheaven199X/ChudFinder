// Fixture screenshots with headless Chrome via puppeteer-core (temp profile, no X access).
// Usage: sh tools/shots/prepare.sh && NODE_PATH=<dir with puppeteer-core> node tools/shots/shoot.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
const OUT = 'verification/screenshots';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true,
  userDataDir: '/tmp/cf-shots/pp-profile', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
async function shot(url, name, w, h, full = true) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto('file:///tmp/cf-shots/' + url, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: OUT + '/' + name + '.png', fullPage: full });
  console.log('wrote', name);
}
await shot('x.html#popover', '1-badge-and-popover', 640, 480, false);
await shot('xl.html#popover', '1-badge-and-popover-light', 640, 480, false);
for (const t of ['Overview', 'Origin', 'Narrative', 'Claims', 'Evidence']) await shot('panel.html#' + t, '2-panel-' + t, 420, 900);
await shot('panel.html#png', '3-receipt-png', 1220, 800, true);
await shot('panel.html#thread', '4-thread-draft', 420, 700);
await browser.close();
