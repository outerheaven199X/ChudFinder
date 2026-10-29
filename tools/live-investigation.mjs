/* Real, credential-free acceptance run against NASA's published article. No X browser automation. */
import { chromium } from 'playwright-core';
import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { startServer } from '../server/adapter.ts';
import { syntheticMandate } from '../test/synthetic.ts';
const output = resolve(process.env.CF_EVIDENCE_DIR || '../live-acceptance');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(resolve('../brave-acceptance-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath:
    process.env.BRAVE_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  headless: true,
  args: [
    '--disable-extensions-except=' + resolve('dist'),
    '--load-extension=' + resolve('dist'),
    '--no-first-run',
  ],
  viewport: { width: 760, height: 1050 },
  acceptDownloads: true,
});
let server;
const errors = [],
  checks = [];
try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = worker.url().split('/')[2];
  process.env.CF_EXTENSION_ORIGINS = 'chrome-extension://' + id;
  server = startServer(18879);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('chrome-extension://' + id + '/src/sidepanel.html');
  await page.locator('#controls>summary').click();
  await page.getByText('Provider connection', { exact: true }).click();
  await page.locator('#adapterUrl').fill('http://127.0.0.1:18879');
  await page.locator('#saveProvider').click();
  await page.waitForFunction(() =>
    document.getElementById('providerState').textContent.includes('X API:'),
  );
  checks.push('Extension loaded; actual loopback CORS provider connection established.');
  await page.locator('#accountHandle').fill('NASA');
  await page.locator('#startInvestigation').click();
  await page.waitForFunction(() => document.querySelectorAll('.story-section').length === 7);
  checks.push('Seven story stages generated without Grok.');
  await page.getByText('External sources and Claim Autopsy', { exact: true }).click();
  const url = 'https://www.nasa.gov/history/july-20-1969-one-giant-leap-for-mankind/';
  await page.locator('#sourceUrl').fill(url);
  await page.locator('#retrieveSources').click();
  await page.waitForFunction(
    () => document.querySelector('#sourceSelect option')?.textContent.includes('One Giant Leap'),
    { timeout: 30000 },
  );
  checks.push('NASA article retrieved through production background and adapter.');
  const statement = 'The crew splashes down off Hawaii on July 24.';
  if (!(await page.locator('#sourceText').textContent()).includes(statement))
    throw new Error('Live source wording changed; manual review required');
  await page.locator('#claimText').fill(statement);
  await page.locator('#sourcePassage').fill(statement);
  await page.locator('#compareSource').click();
  await page.waitForFunction(() => document.querySelector('#version').value === '3');
  await page.getByText('Search matching posts', { exact: true }).click();
  await page.locator('#propagationQuery').fill('"Apollo 11"');
  await page.locator('#searchPropagation').click();
  await page.waitForFunction(() => document.querySelector('#version').value === '4');
  checks.push('Matching-post search returned a genuine unavailable state (no X API credential).');
  await page.locator('#controls>summary').click();
  await page.screenshot({ path: join(output, 'live-overview.png'), fullPage: true });
  await page.getByRole('tab', { name: 'CLAIMS', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('#main').textContent.includes('supported:'),
  );
  await page.screenshot({ path: join(output, 'live-claim-verification.png'), fullPage: true });
  checks.push(
    'Dated source-passage agreement shown, with scope limitation. No X post was fabricated.',
  );
  await page.getByRole('tab', { name: 'EVIDENCE', exact: true }).click();
  await page.screenshot({ path: join(output, 'live-evidence.png'), fullPage: true });
  await page.getByRole('tab', { name: 'OVERVIEW', exact: true }).click();
  for (const [action, name] of [
    ['export-json', 'live-receipt.json'],
    ['export-png', 'live-receipt.png'],
  ]) {
    const download = page.waitForEvent('download');
    await page.locator('[data-action="' + action + '"]').click();
    await (await download).saveAs(join(output, name));
  }
  await page.locator('[data-action="thread"]').click();
  writeFileSync(join(output, 'live-thread-draft.txt'), await page.locator('#thread').inputValue());
  await page.locator('#closeThread').click();
  checks.push('JSON, PNG and thread draft exported through the installed extension UI.');
  const inv = await page.evaluate(async () => {
    const { ['cf:activeInv']: id } = await chrome.storage.local.get('cf:activeInv');
    return (await chrome.storage.local.get('cf:inv:' + id))['cf:inv:' + id];
  });
  writeFileSync(join(output, 'live-investigation.json'), JSON.stringify(inv, null, 2));
  await page.locator('#version').selectOption('1');
  if ((await page.locator('#main').textContent()).includes('One Giant Leap'))
    throw new Error('Previous snapshot changed');
  await page.locator('#version').selectOption('4');
  checks.push('Previous snapshot remains accessible and isolated from new sources.');
  // Separate, explicitly synthetic test. Imported through the ordinary user-evidence control.
  const fixture = syntheticMandate();
  fixture.correction = 'EXPLICITLY SYNTHETIC ACCEPTANCE FIXTURE; NOT A LIVE INVESTIGATION';
  const fixturePath = join(output, 'synthetic-input.json');
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
  await page.locator('#controls>summary').click();
  await page.getByText('Import user evidence / corrections', { exact: true }).click();
  await page.locator('#evidenceFile').setInputFiles(fixturePath);
  await page.locator('#importEvidence').click();
  await page.waitForFunction(() =>
    document.querySelector('#main').textContent.includes('24 observed posts'),
  );
  await page.locator('#controls>summary').click();
  // Collapse verbose evidence details; the data and all counts remain available on click.
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('.story-section')) d.open = false;
    document.querySelectorAll('.story-section')[4].open = true;
  });
  await page.screenshot({ path: join(output, 'synthetic-narrative.png'), fullPage: true });
  await page.getByRole('tab', { name: 'NARRATIVE', exact: true }).click();
  await page.locator('svg.graph').scrollIntoViewIfNeeded();
  const clickPoint = await page.evaluate(() => {
    for (const line of document.querySelectorAll('svg.graph line')) {
      for (const t of [0.5, 0.35, 0.65]) {
        const p = new DOMPoint(
          Number(line.getAttribute('x1')) * (1-t) + Number(line.getAttribute('x2')) * t,
          Number(line.getAttribute('y1')) * (1-t) + Number(line.getAttribute('y2')) * t,
        ).matrixTransform(line.getScreenCTM());
        if (document.elementFromPoint(p.x, p.y) === line) return {x:p.x, y:p.y};
      }
    }
    return null;
  });
  if (!clickPoint) throw new Error('No graph edge exposes a pointer target');
  await page.mouse.click(clickPoint.x, clickPoint.y);
  if (!(await page.locator('.graph-detail').innerText()).includes('ev_'))
    throw new Error('Pointer activation did not reveal graph evidence');
  await page.locator('svg.graph line').first().focus();
  await page.keyboard.press('Enter');
  if (!(await page.locator('.graph-detail').innerText()).includes('ev_'))
    throw new Error('Graph evidence was not shown');
  await page.screenshot({ path: join(output, 'synthetic-graph.png') });
  checks.push('Synthetic narrative counts and pointer/keyboard relationship evidence rendered in Brave.');
  const synth = await page.evaluate(async () => {
    const a = await chrome.storage.local.get('cf:activeInv');
    return (await chrome.storage.local.get('cf:inv:' + a['cf:activeInv']))[
      'cf:inv:' + a['cf:activeInv']
    ];
  });
  writeFileSync(join(output, 'synthetic-investigation.json'), JSON.stringify(synth, null, 2));
  writeFileSync(
    join(output, 'browser-acceptance.json'),
    JSON.stringify(
      {
        browser: await context.browser().version(),
        extensionId: id,
        packageVersion: '3.0.0',
        checks,
        errors,
        liveSubject: 'NASA',
        sourceUrl: url,
        livePostCount: 0,
        scope:
          'Official NASA account investigation with a retrieved NASA article. X post acquisition and search unavailable; no live propagation dataset.',
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join('; '));
  console.log(JSON.stringify({ ok: true, checks: checks.length, output }));
} catch (e) {
  writeFileSync(
    join(output, 'browser-failure.json'),
    JSON.stringify({ error: e.message, checks, errors }, null, 2),
  );
  throw e;
} finally {
  await context.close();
  if (server) await new Promise((r) => server.close(r));
}
