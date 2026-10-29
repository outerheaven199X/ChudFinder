/* PNG receipt card drawn on a canvas from the local snapshot (no remote assets). */
import { currentSnapshot } from '../shared/engine.ts';
import type { Investigation } from '../shared/schemas.ts';
import { rankFindings } from '../shared/receipts.ts';
import { COLOR, ROLE, FONT } from './styles/tokens.ts';

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number): number {
  const lines: string[] = []; let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/[.,;:]?$/, '\u2026'); }
  for (const l of lines) { ctx.fillText(l, x, y); y += lh; }
  return y;
}

/** Load bundled fonts so the canvas uses them (no-op where FontFace loading is unavailable). */
export async function receiptFontsReady(doc: Document = document): Promise<void> {
  const f = (doc as any).fonts; if (!f || !f.load) return;
  await Promise.all(['800 40px "CF Archivo"', '400 20px "CF Archivo"', '700 15px "CF JetBrains Mono"', '400 14px "CF JetBrains Mono"']
    .map(x => f.load(x).catch(() => null)));
}

function corners(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, arm: number, stroke: number, color: string): void {
  c.fillStyle = color;
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
    c.fillRect(dx > 0 ? cx : cx - arm, dy > 0 ? cy : cy - stroke, arm, stroke);
    c.fillRect(dx > 0 ? cx : cx - stroke, dy > 0 ? cy : cy - arm, stroke, arm);
  }
}
function hazard(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, field: string): void {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = COLOR.voidBlack; c.fillRect(x, y, w, h); c.fillStyle = field;
  for (let i = -h; i < w + h; i += 28) { c.beginPath(); c.moveTo(x + i, y + h); c.lineTo(x + i + h, y); c.lineTo(x + i + h + 14, y); c.lineTo(x + i + 14, y + h); c.fill(); }
  c.restore();
}

export function drawReceipt(canvas: HTMLCanvasElement, inv: Investigation, version?: number): void {
  const s = currentSnapshot(inv, version);
  const W = 1200, H = 675; canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d')!;
  const flags = '"Twemoji Country Flags", ';
  const mono = flags + FONT.mono, sans = flags + FONT.sans;
  c.fillStyle = ROLE.ground; c.fillRect(0, 0, W, H);
  hazard(c, 0, 0, W, 14, ROLE.field);
  c.fillStyle = ROLE.surface; c.fillRect(40, 50, W - 80, H - 90);
  c.strokeStyle = ROLE.rule; c.lineWidth = 1; c.strokeRect(40.5, 50.5, W - 81, H - 91);
  corners(c, 40, 50, W - 80, H - 90, 18, 3, ROLE.mark);
  c.fillStyle = ROLE.field; c.fillRect(72, 78, 236, 26);
  c.fillStyle = ROLE.onField; c.font = '700 14px ' + mono; c.fillText('CHUD FINDER', 82, 96);
  c.fillStyle = ROLE.inkDim; c.fillText('PROVENANCE RECEIPT', 322, 96);
  c.fillStyle = ROLE.field; c.font = '800 46px ' + sans; (c as any).fontStretch = 'expanded';
  c.fillText('@' + inv.subject.handle, 72, 160);
  (c as any).fontStretch = 'normal';
  c.fillStyle = ROLE.mark; c.fillRect(72, 176, W - 144, 2.4);
  c.font = '600 21px ' + sans; c.fillStyle = ROLE.ink;
  let y = wrap(c, s.headline, 72, 212, W - 144, 29, 2) + 14;
  const fs = rankFindings(s.findings).slice(0, 6);
  for (const f of fs) {
    const amber = f.basis === 'inferred' || f.basis === 'unknown' || f.status === 'conflict';
    const label = ('[' + f.basis + ']').toUpperCase();
    c.font = '700 13px ' + mono;
    const lw = c.measureText(label).width + 16;
    c.strokeStyle = amber ? COLOR.emberOrange : COLOR.overstructureBlue; c.lineWidth = 1;
    c.strokeRect(72.5, y - 15.5, lw, 21);
    c.fillStyle = amber ? COLOR.emberOrange : '#8ea4ff'; c.fillText(label, 80, y);
    c.font = '17px ' + sans; c.fillStyle = ROLE.ink;
    y = wrap(c, f.title + ': ' + f.statement, 250, y, W - 330, 24, 2) + 10;
    if (y > H - 140) break;
  }
  c.fillStyle = ROLE.rule; c.fillRect(72, H - 124, W - 144, 1);
  c.fillStyle = ROLE.inkDim; c.font = '13px ' + mono;
  c.fillText('V' + s.version + ' \u00b7 ' + s.createdAt.replace('T', ' ').slice(0, 16) + ' UTC \u00b7 ' + s.evidenceIds.length + ' evidence items \u00b7 ' + inv.id, 72, H - 100);
  c.fillText('Source: X About this account as seen in the viewer\u2019s session + on-page observations. Country level only.', 72, H - 78);
  c.fillText('A location is context, not proof a post is true or false.', 72, H - 58);
}
