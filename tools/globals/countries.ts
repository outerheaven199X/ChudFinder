// Classic-script build of the country table (globalThis.CFCountries), kept for tests and bot tooling.
import { CFCountries } from '../../src/shared/countries.ts';
(globalThis as any).CFCountries = CFCountries;
declare const module: any;
if (typeof module !== 'undefined' && module.exports) module.exports = CFCountries;
