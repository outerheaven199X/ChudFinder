import { CFLib } from '../../src/ext/lib.ts';
(globalThis as any).CFLib = CFLib;
declare const module: any;
if (typeof module !== 'undefined' && module.exports) module.exports = CFLib;
