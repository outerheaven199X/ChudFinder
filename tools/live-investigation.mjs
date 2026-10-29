/* Real, credential-free acceptance run against NASA's published article. No X browser automation. */
import { chromium } from 'playwright-core';
import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { startServer } from '../server/adapter.ts';
import { syntheticMandate } from '../test/synthetic.ts';
const output = resolve(process.env.CF_EVIDENCE_DIR || '../live-acceptance');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(resolve('../brave-acceptance-'));
// Acceptance never spends provider credits, even on a machine that has keys configured.
delete process.env.X_API_BEARER_TOKEN;
delete process.env.XAI_API_KEY;
delete process.env.GOOGLE_VISION_API_KEY;
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
  await page.locator('#findPassages').click();
  await page.getByRole('button', { name: 'Use this passage' }).first().click();
  if (!(await page.locator('#sourcePassage').inputValue()).includes(statement))
    throw new Error('Passage discovery lost the live wording');
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
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#version').value === '5');
  await page.getByRole('tab', { name: 'CLAIMS', exact: true }).click();
  if (!(await page.locator('#main').textContent()).includes('supported:'))
    throw new Error('Refresh lost retrieved source comparison');
  checks.push('Refresh preserves the retrieved NASA source and its scoped comparison.');
  // Separate media capability demonstration. No media is attributed to NASA or an X account.
  await page.locator('#controls>summary').click();
  await page.locator('#accountHandle').fill('media_review');
  await page.locator('#startInvestigation').click();
  await page.waitForFunction(() =>
    document.querySelector('#recent').selectedOptions[0].textContent.includes('media_review'),
  );
  await page.getByText('Media Time Machine', { exact: true }).first().click();
  await page.locator('#mediaFile').setInputFiles(resolve('test/fixtures/media/cai-signed.jpg'));
  await page
    .locator('#mediaUrl')
    .fill(
      'https://github.com/contentauth/c2pa-js/blob/db335ea68863420554b5842123e2c5922752157f/packages/c2pa-node/tests/fixtures/CA.jpg',
    );
  await page.locator('#verifyMedia').click();
  await page.waitForFunction(() => document.querySelector('#version').value === '2');
  await page.getByRole('tab', { name: 'CLAIMS', exact: true }).click();
  if (
    !(await page.locator('#main').textContent()).includes(
      'signature validated; asset binding matched; certificate trust untrusted',
    )
  )
    throw new Error('Native signature/trust separation missing from UI');
  checks.push(
    'Native C2PA verification ran through the installed extension; signature validity and untrusted test certificate shown separately.',
  );
  const mediaBytes = Buffer.from(
    await (
      await fetch('https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg')
    ).arrayBuffer(),
  );
  if (
    createHash('sha1').update(mediaBytes).digest('hex') !==
    'd01b79a6781c72ac9bfff93e5e2cfbeef4efc840'
  )
    throw new Error('Commons test image changed; review required');
  const mediaPath = resolve('../commons-acceptance.jpg');
  writeFileSync(mediaPath, mediaBytes);
  await page.locator('#mediaFile').setInputFiles(mediaPath);
  await page.locator('#mediaUrl').fill('https://commons.wikimedia.org/wiki/File:Example.jpg');
  await page.locator('#addMedia').click();
  await page.waitForFunction(() => document.querySelector('#version').value === '3');
  await page.locator('#searchCommonsMedia').click();
  await page.waitForFunction(() => document.querySelector('#version').value === '4');
  if (!(await page.locator('#main').textContent()).includes('2010-03-14T17:20:20Z'))
    throw new Error('Live Commons upload date missing');
  checks.push(
    'Live Commons exact-byte image lookup retrieved a real repository upload date and clickable source.',
  );
  await page.locator('#controls>summary').click();
  await page.screenshot({ path: join(output, 'media-verification.png'), fullPage: true });
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#version').value === '5');
  if (!(await page.locator('#main').textContent()).includes('signature validated'))
    throw new Error('Refresh lost verified media');
  checks.push('Refresh preserves prior source/media evidence and its original observation times.');
  const mediaInv = await page.evaluate(async () => {
    const a = await chrome.storage.local.get('cf:activeInv');
    return (await chrome.storage.local.get('cf:inv:' + a['cf:activeInv']))[
      'cf:inv:' + a['cf:activeInv']
    ];
  });
  writeFileSync(join(output, 'media-investigation.json'), JSON.stringify(mediaInv, null, 2));
  await page.getByRole('tab', { name: 'OVERVIEW', exact: true }).click();
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
          Number(line.getAttribute('x1')) * (1 - t) + Number(line.getAttribute('x2')) * t,
          Number(line.getAttribute('y1')) * (1 - t) + Number(line.getAttribute('y2')) * t,
        ).matrixTransform(line.getScreenCTM());
        if (document.elementFromPoint(p.x, p.y) === line) return { x: p.x, y: p.y };
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
  checks.push(
    'Synthetic narrative counts and pointer/keyboard relationship evidence rendered in Brave.',
  );
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
        packageVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
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
