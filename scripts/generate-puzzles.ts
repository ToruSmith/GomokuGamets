/**
 * 產生殘局題：讓偏弱的 AI 自我對弈，從過程中挑出「輪到的一方有連續衝四必勝」的局面，
 * 並算出最短手數。執行：node --import tsx scripts/generate-puzzles.ts > src/core/puzzle-data.ts
 */
import { Engine } from '../src/ai/engine.ts';
import { LEVEL_LIMITS } from '../src/ai/levels.ts';
import { Game } from '../src/core/game.ts';
import type { Stone } from '../src/core/types.ts';

const WANTED: Record<number, number> = { 2: 4, 3: 4, 4: 3, 5: 3 };
let seed = 20261103;
const random = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

/** 最短需要自己下幾手 */
function shortestWin(engine: Engine, stone: Stone): number | null {
  for (let own = 1; own <= 8; own++) {
    if (engine.findVcf(stone, own - 1, 60000)) return own;
  }
  return null;
}

const found = new Map<number, { moves: number[]; own: number }[]>();
const remaining = (own: number): number => (WANTED[own] ?? 0) - (found.get(own)?.length ?? 0);
const engine = new Engine(15, 'freestyle');
const probe = new Engine(15, 'freestyle');

for (let round = 0; round < 4000 && Object.keys(WANTED).some((k) => remaining(+k) > 0); round++) {
  const game = new Game();
  let lastPick = -100;
  while (!game.result) {
    engine.setPosition(game.moves);
    const limits = { ...LEVEL_LIMITS.easy, timeMs: 10, noise: 500 };
    const { move } = engine.search(limits, random);
    if (game.moves.length >= 12 && game.moves.length - lastPick > 8) {
      probe.setPosition(game.moves);
      const own = shortestWin(probe, game.turn);
      if (own && remaining(own) > 0) {
        const list = found.get(own) ?? [];
        list.push({ moves: [...game.moves], own });
        found.set(own, list);
        lastPick = game.moves.length;
      }
    }
    game.play(move);
  }
}

const puzzles = [...found.values()].flat().sort((a, b) => a.own - b.own);
const rows = puzzles
  .map((puzzle) => `  { moves: [${puzzle.moves.join(', ')}], winIn: ${puzzle.own} },`)
  .join('\n');
console.log(`// 由 scripts/generate-puzzles.ts 產生，tests/puzzles.test.ts 會驗證每題都解得開。
export interface Puzzle {
  moves: number[];
  /** 最少要自己再下幾手才能成五 */
  winIn: number;
}

export const PUZZLES: Puzzle[] = [
${rows}
];`);
