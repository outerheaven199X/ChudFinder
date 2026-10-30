import { Investigation } from '../shared/schemas.ts';
import { findCountry, flagEmoji } from '../shared/countries.ts';
import { cleanText } from '../shared/sanitize.ts';

/** Display only the current snapshot's recorded About field, never a profile-location guess. */
export function countryBadge(raw: unknown, handle: string) {
  const unknown = { flag: '?', name: '', warning: false,
    detail: 'Country unavailable: no recorded X About observation. Click to investigate @' + handle + '.' };
  const parsed = Investigation.safeParse(raw);
  if (!parsed.success || parsed.data.subject.handle.toLowerCase() !== handle.toLowerCase()) return unknown;
  const inv = parsed.data, snapshot = inv.snapshots.find(s => s.version === inv.currentVersion);
  if (!snapshot) return unknown;
  const current = inv.evidence.filter(e => snapshot.evidenceIds.includes(e.id) && e.subject.toLowerCase() === handle.toLowerCase());
  const accepted = (e: typeof current[number]) => !!e.url && (e.provenance === 'user_captured' ||
    (e.provenance === 'platform_reported' && e.provider === 'XOfficialProvider'));
  const based = current.find(e => e.kind === 'about_based_in' && accepted(e));
  if (!based || typeof based.value.basedIn !== 'string' || !based.value.basedIn.trim()) return unknown;
  const name = cleanText(based.value.basedIn,80), country = findCountry(name);
  const accuracy = current.find(e => e.kind === 'about_location_accuracy' && accepted(e));
  const warning = accuracy?.value.accurate === false;
  const label = based.provenance === 'platform_reported' ? 'X-reported About field' : 'User-captured X display';
  return {
    flag: country ? flagEmoji(country.code) : '🌐', name: country?.name || name, warning,
    detail: label + ': ' + name + (country ? '' : ' (region)') + '. Observed ' + based.observedAt + '.\n' + based.url +
      (warning ? '\nX displayed a location-accuracy warning.' : '') +
      '\nRecorded context, not proof of physical location or identity. Click to investigate @' + handle + '.',
  };
}
