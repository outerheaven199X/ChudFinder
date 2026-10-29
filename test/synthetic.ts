/* Explicitly synthetic records. Never used by production code or live demonstrations. */
import { obs, post, T0 } from './helpers.ts';
export const propagationText =
  'A separate duplicated claim about water requires documentary confirmation and a dated public source';
export function syntheticMandate() {
  const own = Array.from({ length: 24 }, (_, i) =>
    post(
      String(1000 + i),
      'synthetic',
      i < 14
        ? 'The US border authority recorded fourteen crossings during the September reporting period.' +
            (i < 9 ? " Share before it's gone." : '')
        : i < 20
          ? 'European Parliament approved renewable energy investment after regional budget negotiations.'
          : 'I photographed the garden flowers and listened to music.',
      new Date(Date.UTC(2026, 9, 1 + (i % 12), 10 + (i % 8))).toISOString(),
    ),
  );
  const matches = Array.from({ length: 38 }, (_, i) =>
    post(
      String(2000 + i),
      'fixture_' + i,
      propagationText,
      new Date(Date.UTC(2026, 9, 20) + Math.round((i * 5 * 3600000) / 37)).toISOString(),
    ),
  );
  return obs('synthetic', null, {
    posts: [...own, ...matches],
    searchText: propagationText,
    focusPostId: '1000',
    provider: 'UserEvidenceProvider',
    coverage: [
      {
        provider: 'SyntheticFixture',
        retrievedAt: T0,
        query: 'EXPLICITLY SYNTHETIC acceptance dataset',
        start: '2026-10-01T00:00:00.000Z',
        end: T0,
        recordsExamined: 62,
        complete: false,
        nextCursor: null,
        fields: ['posts'],
        limitations: ['Synthetic test records; not a live investigation.'],
        status: 'ok',
      },
    ],
  });
}
