// Reproducible build: TypeScript -> dist/ (unpacked MV3 extension) + chud-finder-<version>.zip
// Usage: npm run build            (works on Windows, macOS, Linux; Node >= 22)
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { cssVars, fontFaces, cornersBg, HAZARD } from '../src/ext/styles/tokens.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'src'), { recursive: true });

const entries = {
  content: 'src/ext/content.ts', background: 'src/ext/background.ts',
  options: 'src/ext/options.ts', popup: 'src/ext/popup.ts', sidepanel: 'src/ext/sidepanel.ts',
  // classic-script globals (CFCountries / CFLib / CFSettings) for tests and bot tooling
  countries: 'tools/globals/countries.ts', lib: 'tools/globals/lib.ts', 'settings-schema': 'tools/globals/settings-schema.ts'
};
for (const [name, file] of Object.entries(entries)) {
  await build({
    entryPoints: [join(root, file)], outfile: join(dist, 'src', name + '.js'), bundle: true, format: 'iife',
    target: ['chrome111'], platform: 'browser', charset: 'utf8', legalComments: 'none', minify: false, sourcemap: false,
    banner: { js: '/* Chud Finder ' + pkg.version + ' - built from ' + file + ' */' }, logLevel: 'warning', logOverride: { 'commonjs-variable-in-esm': 'silent' }
  });
}

const st = join(root, 'static');
const manifest = JSON.parse(readFileSync(join(st, 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const f of readdirSync(st)) {
  if (f === 'manifest.json') continue;
  const p = join(st, f);
  if (statSync(p).isDirectory()) cpSync(p, join(dist, f), { recursive: true });
  else cpSync(p, join(dist, 'src', f));
}

// Inline design tokens into CSS/HTML (see src/ext/styles/tokens.ts).
const TOKENS = { '/*@cf-fonts-ext*/': fontFaces('chrome-extension://__MSG_@@extension_id__/fonts/'), '/*@cf-fonts-page*/': fontFaces('../fonts/'),
  '/*@cf-vars*/': cssVars(), '/*@cf-corners*/': cornersBg(), '/*@cf-hazard*/': HAZARD(), '/*@cf-hazard-red*/': HAZARD('var(--cf-hazard)') };
for (const f of readdirSync(join(dist, 'src'))) {
  if (!/\.(css|html)$/.test(f)) continue;
  const p = join(dist, 'src', f); let s = readFileSync(p, 'utf8');
  for (const [k, v] of Object.entries(TOKENS)) s = s.split(k).join(v);
  if (s.includes('/*@cf-')) throw new Error('unresolved token marker in ' + f);
  writeFileSync(p, s);
}

// Zip with manifest.json at the archive root (deterministic order and timestamps).
function walk(d) { return readdirSync(d).sort().flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }
const files = walk(dist);
const chunks = [], central = []; let offset = 0;
const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 10 << 5 | 29;
for (const f of files) {
  const name = Buffer.from(relative(dist, f).split(sep).join('/'));
  const data = readFileSync(f); const comp = deflateRawSync(data, { level: 9 }); const crc = crc32(data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
  lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
  chunks.push(lh, name, comp);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
  ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
  central.push(ch, name);
  offset += lh.length + name.length + comp.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
const zipPath = join(root, 'chud-finder-' + pkg.version + '.zip');
writeFileSync(zipPath, Buffer.concat([...chunks, cd, end]));
console.log('built dist/ (' + files.length + ' files) and ' + relative(root, zipPath));
