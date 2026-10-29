import { CFSettings } from '../../src/shared/settings-schema.ts';
(globalThis as any).CFSettings = CFSettings;
declare const module: any;
if (typeof module !== 'undefined' && module.exports) module.exports = CFSettings;
