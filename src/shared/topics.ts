/* Deterministic topic tagging for topic mode. A small, auditable keyword lexicon maps a post to the
 * country/region whose domestic affairs it discusses, and compares that with where X reports the
 * account is based. Output is a neutral, INFERRED signal. It never says anything about intent,
 * accuracy, or nationality. */

export interface TopicRegion { id: string; label: string; countries: string[]; terms: RegExp[] }

const EU_MEMBERS = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];

// Phrases are matched case-insensitively on word boundaries; ALL-CAPS acronyms are matched case-sensitively.
function terms(words: string[], acronyms: string[] = []): RegExp[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const out: RegExp[] = [];
  if (words.length) out.push(new RegExp('\\b(?:' + words.map(esc).join('|') + ')\\b', 'gi'));
  if (acronyms.length) out.push(new RegExp('\\b(?:' + acronyms.map(esc).join('|') + ')\\b', 'g'));
  return out;
}

export const TOPIC_REGIONS: TopicRegion[] = [
  { id: 'US', label: 'US', countries: ['US'], terms: terms(
    ['Congress', 'US Senate', 'White House', 'Capitol Hill', 'Supreme Court of the United States', 'Medicare', 'Medicaid', 'Social Security',
      'Second Amendment', 'midterms', 'Electoral College', 'Pentagon', 'Federal Reserve', 'US border', 'southern border', 'American voters',
      'Democrats', 'Republicans', 'GOP', 'swing states'], ['FEMA', 'IRS', 'SCOTUS', 'ICE', 'FBI', 'USA']) },
  { id: 'EU', label: 'EU', countries: EU_MEMBERS, terms: terms(
    ['European Union', 'European Commission', 'European Parliament', 'Brussels', 'eurozone', 'Schengen', 'MEPs', 'EU migration pact'], ['EU', 'ECB']) },
  { id: 'GB', label: 'UK', countries: ['GB'], terms: terms(['Westminster', 'Downing Street', 'House of Commons', 'Home Office', 'Brexit'], ['NHS', 'UK']) },
  { id: 'IN', label: 'India', countries: ['IN'], terms: terms(['Lok Sabha', 'Rajya Sabha', 'Election Commission of India', 'rupee', 'Aadhaar'], ['BJP', 'RBI']) },
  { id: 'CA', label: 'Canada', countries: ['CA'], terms: terms(['Parliament Hill', 'House of Commons of Canada', 'Ottawa'], ['RCMP', 'CBSA']) },
  { id: 'AU', label: 'Australia', countries: ['AU'], terms: terms(['Canberra', 'Centrelink'], []) },
  { id: 'BR', label: 'Brazil', countries: ['BR'], terms: terms(['Planalto', 'Bolsa Família', 'Brasília'], ['STF']) }
];

/** Region ids whose domestic topics a post discusses (stable order). */
export function topicTags(text: string): string[] {
  const t = String(text || '');
  const out: string[] = [];
  for (const r of TOPIC_REGIONS) {
    if (r.terms.some(re => { re.lastIndex = 0; return re.test(t); })) out.push(r.id);
  }
  return out;
}

export interface TopicSignal { basis: 'inferred'; topics: string[]; labels: string[]; basedInCode: string; basedInName: string; mismatch: boolean; text: string }

/** Compare a post's topic tags with the country X reports. Returns null when there is nothing to say. */
export function topicSignal(postText: string, basedInCode: string | null, basedInName: string | null): TopicSignal | null {
  if (!basedInCode || !basedInName) return null;
  const topics = topicTags(postText);
  if (!topics.length) return null;
  const regions = topics.map(id => TOPIC_REGIONS.find(r => r.id === id)!);
  const mismatch = !regions.some(r => r.countries.includes(basedInCode));
  if (!mismatch) return null;
  const labels = regions.map(r => r.label);
  return { basis: 'inferred', topics, labels, basedInCode, basedInName, mismatch,
    text: 'Post discusses ' + labels.join('/') + ' topics \u00b7 X reports account based in ' + basedInName +
      ' \u00b7 topic/location mismatch \u2014 a signal, not proof.' };
}
