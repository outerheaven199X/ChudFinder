# Media verification fixtures

`cai-signed.jpg` is `CA.jpg`; `cai-unsigned.jpg` is `A.jpg`, from the Content Authenticity Initiative's c2pa-js Node tests. Retrieved 2026-10-29 from `packages/c2pa-node/tests/fixtures/` at upstream revision `db335ea68863420554b5842123e2c5922752157f`. The upstream MIT license is retained in LICENSE.txt.

- Signed SHA-256: `e71bff58fc57640803e6e65f7534e2fb0c2f99018c85276cc14b30f04427cc76`
- Unsigned SHA-256: `f999fd78bfe8a83c96e468a078830ba94485bc1bc6fd086fb94a43bd29dd0f23`

The signed file uses a test certificate. Expected results distinguish valid signature/binding from untrusted identity. The tampering test changes one byte of a copy in memory and expects binding mismatch. These are SDK validation fixtures, not evidence concerning an X account.

[Upstream files](https://github.com/contentauth/c2pa-js/tree/db335ea68863420554b5842123e2c5922752157f/packages/c2pa-node/tests/fixtures)

`synthetic-exif.jpg` is a locally generated 9 x 8 solid-color test image containing invented date, artist, camera and GPS fields. It tests the metadata allowlist and depicts no real event or person.
