import { colOf, rowOf } from '../core/rules.ts';
import { cellName } from '../core/notation.ts';
import type { ForbiddenReason, Stone } from '../core/types.ts';
import { BLACK, stoneAtPly } from '../core/types.ts';
import { clear, h, s } from './dom.ts';

export interface BoardModel {
  size: number;
  moves: readonly number[];
  line: readonly number[];
  forbidden: ReadonlyMap<number, ForbiddenReason>;
  hint: number | null;
  /** 復盤時顯示的 AI 建議 */
  suggestion: number | null;
  interactive: boolean;
  /** 目前可落子的顏色（用於預覽） */
  turn: Stone;
  coords: boolean;
  numbers: boolean;
  seal: string | null;
  /** 新棋子要不要播落下動畫 */
  animate: boolean;
}

/** SVG 座標：每格 100 單位，四周留 80 給座標標籤。 */
const UNIT = 100;
const MARGIN = 80;
const STONE_RADIUS = 46;

const pos = (index: number): number => MARGIN + index * UNIT;

function starPoints(size: number): [number, number][] {
  const edge = 3;
  const far = size - 1 - edge;
  const mid = (size - 1) / 2;
  const points: [number, number][] = [
    [edge, edge],
    [edge, far],
    [far, edge],
    [far, far],
    [mid, mid],
  ];
  if (size === 19) {
    points.push([edge, mid], [mid, edge], [mid, far], [far, mid]);
  }
  return points;
}

export interface BoardEvents {
  onPlay: (cell: number) => void;
  onHover?: (cell: number | null) => void;
  /** 回傳 true 表示觸控要點兩下確認 */
  touchConfirm: () => boolean;
}

/** 棋盤以 SVG 繪製，任何尺寸都清晰，座標換算交給瀏覽器的矩陣，不必自己算邊框。 */
export class BoardView {
  readonly element: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly gridLayer: SVGElement;
  private readonly stoneLayer: SVGElement;
  private readonly markLayer: SVGElement;
  private readonly ghostLayer: SVGElement;
  private readonly lineLayer: SVGElement;
  private readonly sealElement: HTMLElement;
  private readonly stones = new Map<number, { node: SVGElement; ply: number }>();
  private model: BoardModel | null = null;
  private builtFor = '';
  private ghostCell: number | null = null;
  /** 觸控預覽中的格子 */
  private pending: number | null = null;
  private cursor: number | null = null;
  private lineKey = '';
  private sealKey: string | null = null;

  constructor(
    private readonly events: BoardEvents,
    label: string,
  ) {
    this.gridLayer = s('g');
    this.lineLayer = s('g');
    this.stoneLayer = s('g');
    this.markLayer = s('g');
    this.ghostLayer = s('g');
    this.svg = s(
      'svg',
      {
        class: 'board-svg',
        role: 'application',
        tabindex: 0,
        'aria-label': label,
      },
      s(
        'defs',
        null,
        s(
          'radialGradient',
          { id: 'stone-black', cx: '36%', cy: '32%', r: '72%' },
          s('stop', { offset: '0%', 'stop-color': '#5b6068' }),
          s('stop', { offset: '45%', 'stop-color': '#23262c' }),
          s('stop', { offset: '100%', 'stop-color': '#0a0b0e' }),
        ),
        s(
          'radialGradient',
          { id: 'stone-white', cx: '38%', cy: '32%', r: '78%' },
          s('stop', { offset: '0%', 'stop-color': '#ffffff' }),
          s('stop', { offset: '62%', 'stop-color': '#f1efe8' }),
          s('stop', { offset: '100%', 'stop-color': '#c4c2b8' }),
        ),
        s(
          'filter',
          { id: 'seal-rough', x: '-5%', y: '-5%', width: '110%', height: '110%' },
          s('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.09, numOctaves: 3, seed: 4 }),
          s('feDisplacementMap', { in: 'SourceGraphic', scale: 5 }),
        ),
        s(
          'radialGradient',
          { id: 'stone-shadow' },
          s('stop', { offset: '60%', 'stop-color': '#000', 'stop-opacity': 0.42 }),
          s('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': 0 }),
        ),
      ),
      this.gridLayer,
      this.stoneLayer,
      this.lineLayer,
      this.markLayer,
      this.ghostLayer,
    ) as SVGSVGElement;
    this.sealElement = h('div', { class: 'seal', hidden: true, 'aria-hidden': 'true' });
    this.element = h('div', { class: 'board' }, this.svg, this.sealElement);
    this.bind();
  }

  private bind(): void {
    let pointerType = 'mouse';
    let downAt: { x: number; y: number } | null = null;
    this.svg.addEventListener('pointerdown', (event) => {
      pointerType = event.pointerType;
      downAt = { x: event.clientX, y: event.clientY };
    });
    this.svg.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      this.setGhost(this.cellAt(event));
    });
    this.svg.addEventListener('pointerleave', () => {
      if (this.pending === null) this.setGhost(null);
    });
    this.svg.addEventListener('pointerup', (event) => {
      // 手指滑動是在捲動頁面，不是落子
      if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 12) return;
      const cell = this.cellAt(event);
      if (cell === null || !this.model?.interactive) return;
      if (pointerType !== 'mouse' && this.events.touchConfirm() && this.pending !== cell) {
        this.pending = cell;
        this.setGhost(cell);
        return;
      }
      this.pending = null;
      this.setGhost(null);
      this.events.onPlay(cell);
    });
    this.svg.addEventListener('keydown', (event) => this.handleKey(event));
    this.svg.addEventListener('blur', () => {
      this.cursor = null;
      this.drawCursor();
    });
    this.svg.addEventListener('focus', () => {
      if (!this.svg.matches(':focus-visible') || !this.model) return;
      const { size, moves } = this.model;
      this.cursor = moves.at(-1) ?? Math.floor(size / 2) * (size + 1);
      this.drawCursor();
    });
  }

  private handleKey(event: KeyboardEvent): void {
    const model = this.model;
    if (!model) return;
    const { size } = model;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = moves[event.key];
    if (delta) {
      event.preventDefault();
      const current = this.cursor ?? Math.floor(size / 2) * (size + 1);
      const row = Math.min(size - 1, Math.max(0, rowOf(current, size) + delta[0]));
      const col = Math.min(size - 1, Math.max(0, colOf(current, size) + delta[1]));
      this.cursor = row * size + col;
      this.drawCursor();
    } else if ((event.key === 'Enter' || event.key === ' ') && this.cursor !== null) {
      event.preventDefault();
      if (model.interactive) this.events.onPlay(this.cursor);
    }
  }

  /** 螢幕座標換算成棋盤格；離交叉點太遠（在棋盤外）回傳 null。 */
  private cellAt(event: { clientX: number; clientY: number }): number | null {
    const matrix = this.svg.getScreenCTM();
    if (!matrix || !this.model) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const { size } = this.model;
    const col = Math.round((point.x - MARGIN) / UNIT);
    const row = Math.round((point.y - MARGIN) / UNIT);
    if (row < 0 || col < 0 || row >= size || col >= size) return null;
    return row * size + col;
  }

  private setGhost(cell: number | null): void {
    const model = this.model;
    const next = model?.interactive && cell !== null && !model.moves.includes(cell) ? cell : null;
    if (next === this.ghostCell) return;
    this.ghostCell = next;
    this.drawGhost();
  }

  private drawGhost(): void {
    clear(this.ghostLayer);
    const model = this.model;
    if (!model || this.ghostCell === null) return;
    const blocked = model.forbidden.has(this.ghostCell);
    const x = pos(colOf(this.ghostCell, model.size));
    const y = pos(rowOf(this.ghostCell, model.size));
    this.ghostLayer.appendChild(
      blocked
        ? s('circle', { cx: x, cy: y, r: 30, class: 'ghost-blocked' })
        : s('circle', {
            cx: x,
            cy: y,
            r: STONE_RADIUS,
            class: this.pending === null ? 'ghost' : 'ghost is-pending',
            fill: `url(#stone-${model.turn === BLACK ? 'black' : 'white'})`,
          }),
    );
  }

  private drawCursor(): void {
    this.svg.querySelector('.cursor')?.remove();
    const model = this.model;
    if (!model || this.cursor === null) return;
    const x = pos(colOf(this.cursor, model.size));
    const y = pos(rowOf(this.cursor, model.size));
    this.markLayer.appendChild(
      s('rect', { class: 'cursor', x: x - 46, y: y - 46, width: 92, height: 92, rx: 12 }),
    );
    this.svg.setAttribute('aria-roledescription', cellName(this.cursor, model.size));
  }

  private buildGrid(size: number, coords: boolean): void {
    const extent = pos(size - 1) + MARGIN;
    this.svg.setAttribute('viewBox', `0 0 ${extent} ${extent}`);
    clear(this.gridLayer);
    const end = pos(size - 1);
    let path = '';
    for (let i = 0; i < size; i++) {
      path += `M${pos(0)} ${pos(i)}H${end}M${pos(i)} ${pos(0)}V${end}`;
    }
    this.gridLayer.appendChild(s('path', { d: path, class: 'grid-lines' }));
    this.gridLayer.appendChild(
      s('rect', {
        x: pos(0),
        y: pos(0),
        width: end - pos(0),
        height: end - pos(0),
        class: 'grid-frame',
      }),
    );
    for (const [row, col] of starPoints(size)) {
      this.gridLayer.appendChild(s('circle', { cx: pos(col), cy: pos(row), r: 9, class: 'star' }));
    }
    if (!coords) return;
    for (let i = 0; i < size; i++) {
      this.gridLayer.appendChild(
        s('text', { x: pos(i), y: 44, class: 'coord' }, String.fromCharCode(65 + i)),
      );
      this.gridLayer.appendChild(
        s('text', { x: pos(i), y: extent - 26, class: 'coord' }, String.fromCharCode(65 + i)),
      );
      this.gridLayer.appendChild(s('text', { x: 34, y: pos(i) + 12, class: 'coord' }, size - i));
      this.gridLayer.appendChild(
        s('text', { x: extent - 34, y: pos(i) + 12, class: 'coord' }, size - i),
      );
    }
  }

  private makeStone(cell: number, ply: number, model: BoardModel): SVGElement {
    const stone = stoneAtPly(ply);
    const x = pos(colOf(cell, model.size));
    const y = pos(rowOf(cell, model.size));
    const name = stone === BLACK ? 'black' : 'white';
    return s(
      'g',
      { class: `stone ${name}${model.animate ? ' drop' : ''}`, 'data-cell': cell },
      s('circle', { cx: x + 5, cy: y + 8, r: STONE_RADIUS + 3, fill: 'url(#stone-shadow)' }),
      s('circle', {
        class: 'stone-body',
        cx: x,
        cy: y,
        r: STONE_RADIUS,
        fill: `url(#stone-${name})`,
      }),
      model.numbers ? s('text', { x, y: y + 13, class: 'stone-number' }, ply + 1) : null,
    );
  }

  update(model: BoardModel): void {
    const previous = this.model;
    this.model = model;
    const key = `${model.size}-${model.coords}`;
    if (key !== this.builtFor) {
      this.builtFor = key;
      this.buildGrid(model.size, model.coords);
    }
    const numbersChanged = previous?.numbers !== model.numbers;
    if (previous?.size !== model.size || numbersChanged) {
      clear(this.stoneLayer);
      this.stones.clear();
    }

    // 只增刪有變動的棋子，動畫才不會整盤重播
    const present = new Map(model.moves.map((cell, ply) => [cell, ply]));
    for (const [cell, entry] of this.stones) {
      if (present.get(cell) !== entry.ply) {
        entry.node.remove();
        this.stones.delete(cell);
      }
    }
    model.moves.forEach((cell, ply) => {
      if (this.stones.has(cell)) return;
      const node = this.makeStone(cell, ply, model);
      this.stoneLayer.appendChild(node);
      this.stones.set(cell, { node, ply });
    });

    this.pending = null;
    if (this.ghostCell !== null) {
      this.ghostCell = null;
      clear(this.ghostLayer);
    }

    this.drawMarks(model);
    this.drawWinLine(model);
    this.drawSeal(model);
    this.svg.classList.toggle('is-interactive', model.interactive);
    this.drawCursor();
  }

  private drawMarks(model: BoardModel): void {
    clear(this.markLayer);
    const { size } = model;
    const place = (cell: number) => ({
      x: pos(colOf(cell, size)),
      y: pos(rowOf(cell, size)),
    });
    const last = model.moves.at(-1);
    if (last !== undefined && !model.numbers) {
      const { x, y } = place(last);
      this.markLayer.appendChild(s('circle', { cx: x, cy: y, r: 13, class: 'last-mark' }));
    } else if (last !== undefined) {
      const { x, y } = place(last);
      this.markLayer.appendChild(s('circle', { cx: x, cy: y, r: 46, class: 'last-ring' }));
    }
    for (const cell of model.forbidden.keys()) {
      const { x, y } = place(cell);
      this.markLayer.appendChild(
        s('path', {
          d: `M${x - 17} ${y - 17}l34 34m0-34l-34 34`,
          class: 'forbidden-mark',
        }),
      );
    }
    if (model.hint !== null) {
      const { x, y } = place(model.hint);
      this.markLayer.appendChild(s('circle', { cx: x, cy: y, r: 40, class: 'hint-mark' }));
    }
    if (model.suggestion !== null) {
      const { x, y } = place(model.suggestion);
      this.markLayer.appendChild(s('circle', { cx: x, cy: y, r: 40, class: 'suggest-mark' }));
    }
  }

  private drawWinLine(model: BoardModel): void {
    const key = model.line.join(',');
    if (key === this.lineKey) return;
    this.lineKey = key;
    clear(this.lineLayer);
    const first = model.line[0];
    const last = model.line.at(-1);
    if (first === undefined || last === undefined) return;
    const { size } = model;
    this.lineLayer.appendChild(
      s('line', {
        x1: pos(colOf(first, size)),
        y1: pos(rowOf(first, size)),
        x2: pos(colOf(last, size)),
        y2: pos(rowOf(last, size)),
        class: 'win-line',
        pathLength: 1,
      }),
    );
  }

  /** 印章蓋在離連線最遠的角落，不遮住勝負手。 */
  private drawSeal(model: BoardModel): void {
    const text = model.seal;
    const middle = model.line[Math.floor(model.line.length / 2)];
    const half = (model.size - 1) / 2;
    const top = middle !== undefined && rowOf(middle, model.size) > half;
    const left = middle !== undefined && colOf(middle, model.size) > half;
    const key = text === null ? null : `${text}-${top}-${left}`;
    if (key === this.sealKey) return;
    this.sealKey = key;
    this.sealElement.hidden = text === null;
    this.sealElement.textContent = text ?? '';
    this.sealElement.classList.toggle('is-long', (text?.length ?? 0) > 2);
    this.sealElement.classList.toggle('at-top', top);
    this.sealElement.classList.toggle('at-left', left);
  }

  focus(): void {
    this.svg.focus();
  }
}
