/* Chud Finder - country table. Pure data + helpers, no dependencies.
 * Names follow what X typically returns in "Account based in" (English UI).
 * Aliases cover common alternates (e.g. "Russian Federation", "USA").
 */
(function (root) {
  'use strict';

  // ISO 3166-1 alpha-2 | display name | ;-separated aliases
  const RAW = `AF|Afghanistan
AL|Albania
DZ|Algeria
AS|American Samoa
AD|Andorra
AO|Angola
AI|Anguilla
AG|Antigua and Barbuda|antigua & barbuda
AR|Argentina
AM|Armenia
AW|Aruba
AU|Australia
AT|Austria
AZ|Azerbaijan
BS|Bahamas|the bahamas
BH|Bahrain
BD|Bangladesh
BB|Barbados
BY|Belarus
BE|Belgium
BZ|Belize
BJ|Benin
BM|Bermuda
BT|Bhutan
BO|Bolivia|plurinational state of bolivia
BA|Bosnia and Herzegovina|bosnia & herzegovina;bosnia
BW|Botswana
BR|Brazil|brasil
VG|British Virgin Islands
BN|Brunei|brunei darussalam
BG|Bulgaria
BF|Burkina Faso
BI|Burundi
CV|Cape Verde|cabo verde
KH|Cambodia
CM|Cameroon
CA|Canada
KY|Cayman Islands
CF|Central African Republic
TD|Chad
CL|Chile
CN|China|people's republic of china;prc
CO|Colombia
KM|Comoros
CG|Congo|republic of the congo;congo - brazzaville
CD|DR Congo|democratic republic of the congo;congo - kinshasa;drc
CR|Costa Rica
CI|Côte d'Ivoire|cote d'ivoire;ivory coast
HR|Croatia
CU|Cuba
CW|Curaçao|curacao
CY|Cyprus
CZ|Czechia|czech republic
DK|Denmark
DJ|Djibouti
DM|Dominica
DO|Dominican Republic
EC|Ecuador
EG|Egypt
SV|El Salvador
GQ|Equatorial Guinea
ER|Eritrea
EE|Estonia
SZ|Eswatini|swaziland
ET|Ethiopia
FJ|Fiji
FI|Finland
FR|France
GF|French Guiana
PF|French Polynesia
GA|Gabon
GM|Gambia|the gambia
GE|Georgia
DE|Germany|deutschland
GH|Ghana
GI|Gibraltar
GR|Greece
GL|Greenland
GD|Grenada
GP|Guadeloupe
GU|Guam
GT|Guatemala
GG|Guernsey
GN|Guinea
GW|Guinea-Bissau
GY|Guyana
HT|Haiti
HN|Honduras
HK|Hong Kong|hong kong sar;hong kong sar china
HU|Hungary
IS|Iceland
IN|India|bharat
ID|Indonesia
IR|Iran|islamic republic of iran
IQ|Iraq
IE|Ireland
IM|Isle of Man
IL|Israel
IT|Italy|italia
JM|Jamaica
JP|Japan
JE|Jersey
JO|Jordan
KZ|Kazakhstan
KE|Kenya
KI|Kiribati
XK|Kosovo
KW|Kuwait
KG|Kyrgyzstan
LA|Laos|lao people's democratic republic
LV|Latvia
LB|Lebanon
LS|Lesotho
LR|Liberia
LY|Libya
LI|Liechtenstein
LT|Lithuania
LU|Luxembourg
MO|Macao|macau;macao sar china
MG|Madagascar
MW|Malawi
MY|Malaysia
MV|Maldives
ML|Mali
MT|Malta
MH|Marshall Islands
MQ|Martinique
MR|Mauritania
MU|Mauritius
MX|Mexico|méxico
FM|Micronesia
MD|Moldova|republic of moldova
MC|Monaco
MN|Mongolia
ME|Montenegro
MS|Montserrat
MA|Morocco
MZ|Mozambique
MM|Myanmar|burma;myanmar (burma)
NA|Namibia
NR|Nauru
NP|Nepal
NL|Netherlands|the netherlands;holland
NC|New Caledonia
NZ|New Zealand
NI|Nicaragua
NE|Niger
NG|Nigeria
KP|North Korea|democratic people's republic of korea
MK|North Macedonia|macedonia
MP|Northern Mariana Islands
NO|Norway
OM|Oman
PK|Pakistan
PW|Palau
PS|Palestine|palestinian territories;state of palestine
PA|Panama
PG|Papua New Guinea
PY|Paraguay
PE|Peru
PH|Philippines|the philippines
PL|Poland
PT|Portugal
PR|Puerto Rico
QA|Qatar
RE|Réunion|reunion
RO|Romania
RU|Russia|russian federation
RW|Rwanda
KN|Saint Kitts and Nevis|st. kitts & nevis
LC|Saint Lucia|st. lucia
VC|Saint Vincent and the Grenadines|st. vincent & grenadines
WS|Samoa
SM|San Marino
ST|São Tomé and Príncipe|sao tome and principe
SA|Saudi Arabia
SN|Senegal
RS|Serbia
SC|Seychelles
SL|Sierra Leone
SG|Singapore
SX|Sint Maarten
SK|Slovakia
SI|Slovenia
SB|Solomon Islands
SO|Somalia
ZA|South Africa
KR|South Korea|korea;republic of korea
SS|South Sudan
ES|Spain|españa
LK|Sri Lanka
SD|Sudan
SR|Suriname
SE|Sweden
CH|Switzerland
SY|Syria|syrian arab republic
TW|Taiwan
TJ|Tajikistan
TZ|Tanzania|united republic of tanzania
TH|Thailand
TL|Timor-Leste|east timor
TG|Togo
TO|Tonga
TT|Trinidad and Tobago|trinidad & tobago
TN|Tunisia
TR|Türkiye|turkey;turkiye
TM|Turkmenistan
TC|Turks and Caicos Islands
TV|Tuvalu
UG|Uganda
UA|Ukraine
AE|United Arab Emirates|uae
GB|United Kingdom|uk;great britain;britain;england;scotland;wales;northern ireland
US|United States|usa;u.s.;u.s.a.;united states of america;america
UY|Uruguay
UZ|Uzbekistan
VU|Vanuatu
VA|Vatican City|holy see
VE|Venezuela
VN|Vietnam|viet nam
VI|U.S. Virgin Islands|us virgin islands
YE|Yemen
ZM|Zambia
ZW|Zimbabwe`;

  // X hides the exact country for some small-population countries and shows a
  // region instead. Treat these as regions (globe icon, no flag).
  const REGIONS = [
    'Africa', 'North Africa', 'West Africa', 'East Africa', 'Central Africa', 'Southern Africa',
    'Sub-Saharan Africa', 'Asia', 'Central Asia', 'East Asia', 'East Asia & Pacific', 'South Asia',
    'Southeast Asia', 'West Asia', 'Middle East', 'Middle East & North Africa', 'Europe',
    'Eastern Europe', 'Western Europe', 'Northern Europe', 'Southern Europe', 'North America',
    'South America', 'Latin America', 'Latin America & Caribbean', 'Central America', 'Caribbean',
    'Oceania', 'Australasia', 'Pacific'
  ];

  const COUNTRIES = [];
  const BY_KEY = new Map();

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim();
  }

  for (const line of RAW.split('\n')) {
    const [code, name, aliases] = line.split('|');
    const c = { code, name };
    COUNTRIES.push(c);
    BY_KEY.set(norm(name), c);
    for (const a of (aliases || '').split(';')) if (a) BY_KEY.set(norm(a), c);
  }
  COUNTRIES.sort((a, b) => a.name.localeCompare(b.name));

  const REGION_KEYS = new Set(REGIONS.map(norm));

  /** Look up a country by any known name/alias. Returns {code,name} or null. */
  function findCountry(name) {
    if (!name) return null;
    return BY_KEY.get(norm(name)) || null;
  }

  function isRegion(name) {
    return REGION_KEYS.has(norm(name));
  }

  /** ISO2 -> flag emoji via regional-indicator symbols. */
  function flagEmoji(code) {
    if (!/^[A-Z]{2}$/.test(code || '')) return '';
    if (code === 'XK') return '\u{1F1FD}\u{1F1F0}';
    return String.fromCodePoint(...[...code].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
  }

  // US states (names + USPS codes) so a stated location like "Austin, TX"
  // is understood as United States when checking for mismatches.
  const US_STATES = 'Alabama|AL,Alaska|AK,Arizona|AZ,Arkansas|AR,California|CA,Colorado|CO,Connecticut|CT,Delaware|DE,Florida|FL,Georgia|GA,Hawaii|HI,Idaho|ID,Illinois|IL,Indiana|IN,Iowa|IA,Kansas|KS,Kentucky|KY,Louisiana|LA,Maine|ME,Maryland|MD,Massachusetts|MA,Michigan|MI,Minnesota|MN,Mississippi|MS,Missouri|MO,Montana|MT,Nebraska|NE,Nevada|NV,New Hampshire|NH,New Jersey|NJ,New Mexico|NM,New York|NY,North Carolina|NC,North Dakota|ND,Ohio|OH,Oklahoma|OK,Oregon|OR,Pennsylvania|PA,Rhode Island|RI,South Carolina|SC,South Dakota|SD,Tennessee|TN,Texas|TX,Utah|UT,Vermont|VT,Virginia|VA,Washington|WA,West Virginia|WV,Wisconsin|WI,Wyoming|WY,District of Columbia|DC'
    .split(',').map(p => p.split('|'));

  const api = { COUNTRIES, REGIONS, US_STATES, findCountry, isRegion, flagEmoji, norm };
  root.CFCountries = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
