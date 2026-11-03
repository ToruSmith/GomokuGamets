import type { MoveReview } from '../ai/analysis.ts';
import { cellName } from '../core/notation.ts';
import { t } from '../i18n/index.ts';
import { h, s } from './dom.ts';

const WIDTH = 340;
const HEIGHT = 120;
const PAD_X = 6;
const PAD_Y = 8;

/**
 * 單一序列的折線圖：縱軸固定 0 到 100%，中線 50% 是唯一的參考線。
 * 失誤手用形狀標出，不只靠顏色；逐手數值在下方棋譜列表裡也看得到。
 */
export function chanceChart(
  reviews: readonly MoveReview[],
  moves: readonly number[],
  size: number,
  cursor: () => number,
  onSeek: (ply: number) => void,
): HTMLElement {
  const x = (ply: number): number =>
    PAD_X + ((WIDTH - PAD_X * 2) * ply) / Math.max(1, reviews.length - 1);
  const y = (chance: number): number => PAD_Y + (HEIGHT - PAD_Y * 2) * (1 - chance);

  const line = reviews
    .map(
      (review, ply) =>
        `${ply === 0 ? 'M' : 'L'}${x(ply).toFixed(1)} ${y(review.blackChance).toFixed(1)}`,
    )
    .join('');

  const marks = reviews.flatMap((review, ply) => {
    if (review.quality !== 'blunder' && review.quality !== 'missed-win') return [];
    const cx = x(ply);
    const cy = y(review.blackChance);
    return [s('path', { d: `M${cx} ${cy - 6}l6 6-6 6-6-6z`, class: 'chart-mark' })];
  });

  const tooltip = h('div', { class: 'chart-tip', hidden: true });
  const crosshair = s('line', {
    x1: -10,
    x2: -10,
    y1: PAD_Y,
    y2: HEIGHT - PAD_Y,
    class: 'chart-cross',
  });

  const plyAt = (clientX: number, element: Element): number => {
    const box = element.getBoundingClientRect();
    const ratio = (clientX - box.left) / box.width;
    return Math.max(0, Math.min(reviews.length - 1, Math.round(ratio * (reviews.length - 1))));
  };

  const svg = s(
    'svg',
    {
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      class: 'chart',
      role: 'img',
      'aria-label': t('review.chart'),
      onPointerMove: (event: PointerEvent) => {
        const ply = plyAt(event.clientX, svg);
        const review = reviews[ply] as MoveReview;
        tooltip.hidden = false;
        tooltip.textContent = `${ply + 1}. ${cellName(moves[ply] as number, size)}  ${Math.round(
          review.blackChance * 100,
        )}%  ${t(`quality.${review.quality}`)}`;
        crosshair.setAttribute('x1', String(x(ply)));
        crosshair.setAttribute('x2', String(x(ply)));
      },
      onPointerLeave: () => {
        tooltip.hidden = true;
        crosshair.setAttribute('x1', '-10');
        crosshair.setAttribute('x2', '-10');
      },
      onClick: (event: MouseEvent) => onSeek(plyAt(event.clientX, svg) + 1),
    },
    s('line', { x1: PAD_X, x2: WIDTH - PAD_X, y1: y(0.5), y2: y(0.5), class: 'chart-mid' }),
    s('path', { d: line, class: 'chart-line' }),
    marks,
    crosshair,
    () => {
      const ply = cursor() - 1;
      const review = reviews[ply];
      return review
        ? s('circle', { cx: x(ply), cy: y(review.blackChance), r: 4.5, class: 'chart-dot' })
        : null;
    },
  );
  return h('div', { class: 'chart-wrap' }, svg, tooltip);
}
