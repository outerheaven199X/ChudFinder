# Country badges and investigation corrections

Country badges return beside usernames, using the current investigation's recorded About evidence. Clicking a badge opens the investigation directly. Countries use flags, broader regions use a globe, and missing evidence stays unknown. Source labels and observation dates remain available on hover. Badges update when observations change, are deleted, or X reuses an author row. The display performs local storage reads; it does not restore undocumented X lookups.

Timeline requests now forward the date bounds reported in coverage. Equivalent X/Twitter status links share a graph relationship. The engine retains the previous URL rules when reconstructing older snapshots. Adding evidence preserves the propagation query, and a new search replaces an older full sample while retaining the selected claim.

Validation: `npm run typecheck` and `npm test`. Regressions cover date bounds, URL aliases and historical reconstruction, search replacement and persistence, country provenance, recycled author rows, storage updates, and one-click investigation. The background-query regression also fails against the previous 3.1.1 build as expected.

Full installed-browser acceptance for this release remains unverified: the browser tool rejected extension-URL navigation. Automated DOM/background tests and ordinary HTTP preview checks have different boundaries and must not be described as installed-extension acceptance. About fields remain unavailable without a recorded authorized observation; the standard profile-location field is not a substitute.
