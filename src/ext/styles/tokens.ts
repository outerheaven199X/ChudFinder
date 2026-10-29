/* Chud Finder design tokens (v2.1). Single source of truth for CSS (inlined at build by tools/build.mjs)
 * and canvas rendering (receipt PNG). Palette/spacing/motifs adapted from the user's supplied style kit;
 * no third-party names, logos or marks are used. */
export const COLOR = {
  systemYellow: '#faf905', voidBlack: '#0b0b0d', overstructureBlue: '#6584f8', signalWhite: '#ffffff',
  emissiveCyan: '#00e5ff', riotPink: '#ff0080', warningRed: '#ff3d00', emberOrange: '#ff8a2a',
  panel: '#16161a', ash: '#6a6a72', inkDim: '#9a9aa3'
} as const;
export const ROLE = {
  ground: COLOR.voidBlack, surface: COLOR.panel, ink: COLOR.signalWhite, inkDim: COLOR.inkDim, rule: COLOR.ash,
  field: COLOR.systemYellow, onField: COLOR.voidBlack, mark: COLOR.systemYellow, structure: COLOR.overstructureBlue,
  hazard: COLOR.warningRed, caution: COLOR.emberOrange, focus: COLOR.emissiveCyan
} as const;
export const SPACE = [0, 4, 8, 12, 16, 24, 32, 48, 72] as const;
export const SHAPE = { radius: 0, hairline: 1, sectionRule: 2.4, cornerStroke: 2.2, cornerArm: 14, stripe: 14 } as const;
export const FONT = {
  display: '"CF Archivo", "Archivo", "Helvetica Neue", Arial, sans-serif',
  sans: '"CF Archivo", "Archivo", "Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: '"CF JetBrains Mono", "JetBrains Mono", "Cascadia Mono", Consolas, "Courier New", monospace'
} as const;
const FLAGS = '"Twemoji Country Flags"';
export const FONT_FILES = { flags: 'TwemojiCountryFlags.woff2', sans: 'Archivo-Variable-latin.woff2', mono: 'JetBrainsMono-Variable-latin.woff2' } as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
/** Custom properties (prefixed --cf- so they can never collide with the host page). */
export function cssVars(): string {
  const v: string[] = [];
  for (const [k, c] of Object.entries(COLOR)) v.push(`--cf-${kebab(k)}:${c}`);
  for (const [k, c] of Object.entries(ROLE)) v.push(`--cf-${kebab(k)}:${c}`);
  SPACE.forEach((s, i) => i && v.push(`--cf-space-${i}:${s}px`));
  v.push(`--cf-hairline:${SHAPE.hairline}px`, `--cf-section-rule:${SHAPE.sectionRule}px`, `--cf-corner-stroke:${SHAPE.cornerStroke}px`,
    `--cf-corner-arm:${SHAPE.cornerArm}px`, `--cf-stripe:${SHAPE.stripe}px`, `--cf-radius:${SHAPE.radius}px`);
  v.push(`--cf-font-display:${FLAGS},${FONT.display}`, `--cf-font-sans:${FLAGS},${FONT.sans}`, `--cf-font-mono:${FLAGS},${FONT.mono}`);
  return v.join(';');
}
/** @font-face rules. base = URL prefix for the fonts/ dir. */
export function fontFaces(base: string): string {
  return [
    `@font-face{font-family:${FLAGS};unicode-range:U+1F1E6-1F1FF,U+1F3F4,U+E0062-E0063,U+E0065,U+E0067,U+E006C,U+E006E,U+E0073-E0074,U+E0077,U+E007F;src:url("${base}${FONT_FILES.flags}") format("woff2");font-display:swap}`,
    `@font-face{font-family:"CF Archivo";font-style:normal;font-weight:100 900;font-stretch:62% 125%;src:url("${base}${FONT_FILES.sans}") format("woff2");font-display:swap}`,
    `@font-face{font-family:"CF JetBrains Mono";font-style:normal;font-weight:400 800;src:url("${base}${FONT_FILES.mono}") format("woff2");font-display:swap}`
  ].join('\n');
}
/** Registration-corner motif as backgrounds (no extra DOM). */
export function cornersBg(color = 'var(--cf-mark)'): string {
  const g = `linear-gradient(${color},${color})`, a = 'var(--cf-corner-arm)', s = 'var(--cf-corner-stroke)';
  return [`${g} top left/${a} ${s}`, `${g} top left/${s} ${a}`, `${g} top right/${a} ${s}`, `${g} top right/${s} ${a}`,
    `${g} bottom left/${a} ${s}`, `${g} bottom left/${s} ${a}`, `${g} bottom right/${a} ${s}`, `${g} bottom right/${s} ${a}`]
    .map(x => x + ' no-repeat').join(',');
}
export const HAZARD = (field = 'var(--cf-field)') => `repeating-linear-gradient(-45deg,${field} 0 10px,var(--cf-void-black) 10px 20px)`;
