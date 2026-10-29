/* PNG receipt card drawn on a canvas from the local snapshot (no remote assets). */
import { currentSnapshot } from '../shared/engine.ts';
import type { Investigation } from '../shared/schemas.ts';
import { rankFindings } from '../shared/receipts.ts';

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

export function drawReceipt(canvas: HTMLCanvasElement, inv: Investigation, version?: number): void {
  const s = currentSnapshot(inv, version);
  const W = 1200, H = 675; canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d')!;
  const mono = '"Cascadia Mono", Consolas, ui-monospace, monospace', sans = '"Segoe UI", system-ui, sans-serif';
  c.fillStyle = '#121416'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#1b1e21'; c.fillRect(40, 40, W - 80, H - 80);
  c.fillStyle = '#8b98a5'; c.font = '600 18px ' + mono; c.fillText('CHUD FINDER \u00b7 PROVENANCE RECEIPT', 72, 92);
  c.fillStyle = '#e6e8ea'; c.font = '700 40px ' + sans; c.fillText('@' + inv.subject.handle, 72, 150);
  c.font = '22px ' + sans; c.fillStyle = '#c9d1d9';
  let y = wrap(c, s.headline, 72, 196, W - 144, 30, 2) + 12;
  const fs = rankFindings(s.findings).slice(0, 6);
  for (const f of fs) {
    const amber = f.basis === 'inferred' || f.basis === 'unknown' || f.status === 'conflict';
    c.font = '600 15px ' + mono; c.fillStyle = amber ? '#ffad1f' : '#7fb7e6';
    c.fillText(('[' + f.basis + ']').toUpperCase(), 72, y);
    c.font = '18px ' + sans; c.fillStyle = '#e6e8ea';
    y = wrap(c, f.title + ': ' + f.statement, 250, y, W - 330, 24, 2) + 8;
    if (y > H - 130) break;
  }
  c.fillStyle = '#8b98a5'; c.font = '14px ' + mono;
  c.fillText('v' + s.version + ' \u00b7 ' + s.createdAt.replace('T', ' ').slice(0, 16) + ' UTC \u00b7 ' + s.evidenceIds.length + ' evidence items \u00b7 ' + inv.id, 72, H - 96);
  c.fillText('Source: X About this account as seen in the viewer\u2019s session + on-page observations. Country level only.', 72, H - 72);
  c.fillText('A location is context, not proof a post is true or false.', 72, H - 52);
}
