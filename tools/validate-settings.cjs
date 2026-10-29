// Validate a settings document (schemaVersion 1) exactly as the extension does.
// Usage: npm run build && node tools/validate-settings.cjs < settings.json
const fs = require('fs'), path = require('path'), vm = require('vm');
const f = path.join(__dirname, '../dist/src/settings-schema.js');
if (!fs.existsSync(f)) { console.error('Run `npm run build` first.'); process.exit(2); }
vm.runInThisContext(fs.readFileSync(f, 'utf8'));
const r = globalThis.CFSettings.parseAndValidate(fs.readFileSync(0, 'utf8'));
console.log(JSON.stringify(r));
process.exit(r.ok ? 0 : 1);
