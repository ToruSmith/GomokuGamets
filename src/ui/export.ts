import { colOf, rowOf } from '../core/rules.ts';
import type { Game } from '../core/game.ts';
import { BLACK, stoneAtPly } from '../core/types.ts';

/** 用 Canvas 重新繪製，不依賴畫面上的 SVG 與樣式，輸出固定是乾淨的榧木盤。 */
export async function downloadBoardImage(game: Game, filename: string): Promise<void> {
  const cell = 56;
  const margin = 56;
  const size = game.size;
  const extent = margin * 2 + cell * (size - 1);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = extent;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#d6a860';
  ctx.fillRect(0, 0, extent, extent);
  ctx.strokeStyle = '#4a3216';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < size; i++) {
    const p = margin + i * cell;
    ctx.moveTo(margin, p);
    ctx.lineTo(extent - margin, p);
    ctx.moveTo(p, margin);
    ctx.lineTo(p, extent - margin);
  }
  ctx.stroke();

  game.moves.forEach((move, ply) => {
    const x = margin + colOf(move, size) * cell;
    const y = margin + rowOf(move, size) * cell;
    const radius = cell * 0.46;
    const gradient = ctx.createRadialGradient(x - 8, y - 9, 2, x, y, radius);
    const black = stoneAtPly(ply) === BLACK;
    gradient.addColorStop(0, black ? '#5b6068' : '#ffffff');
    gradient.addColorStop(1, black ? '#0a0b0e' : '#cfcdc4');
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath();
    ctx.arc(x + 2, y + 3, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = black ? '#f1efe8' : '#20242c';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(ply + 1), x, y + 1);
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
