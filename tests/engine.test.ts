import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chanceFromScore, reviewGame } from '../src/ai/analysis.ts';
import { Engine } from '../src/ai/engine.ts';
import { AI_LEVELS, ANALYSIS_LIMITS, LEVEL_LIMITS } from '../src/ai/levels.ts';
import { Game } from '../src/core/game.ts';
import { cellOf, findForbidden } from '../src/core/rules.ts';
import { BLACK } from '../src/core/types.ts';
import type { RuleSet } from '../src/core/types.ts';

const at = (row: number, col: number): number => cellOf(row, col, 15);
const fast = { ...ANALYSIS_LIMITS, timeMs: 150 };

function engineFor(moves: number[], rule: RuleSet = 'freestyle'): Engine {
  const engine = new Engine(15, rule);
  engine.setPosition(moves);
  return engine;
}

/** 雙方棋子各自依序交錯成棋譜；white 可較短，用 fillers 補手數 */
function interleave(blacks: number[], whites: number[]): number[] {
  const moves: number[] = [];
  for (let i = 0; i < Math.max(blacks.length, whites.length); i++) {
    if (blacks[i] !== undefined) moves.push(blacks[i] as number);
    if (whites[i] !== undefined) moves.push(whites[i] as number);
  }
  return moves;
}

describe('引擎戰術', () => {
  it('能成五就成五', () => {
    const moves = interleave(
      [at(7, 5), at(7, 6), at(7, 7), at(7, 8)],
      [at(0, 0), at(0, 2), at(0, 4), at(0, 6)],
    );
    const { move } = engineFor(moves).search(fast);
    assert.ok([at(7, 4), at(7, 9)].includes(move));
  });

  it('對手有四一定擋', () => {
    const moves = interleave(
      [at(7, 5), at(7, 6), at(7, 7), at(7, 8), at(0, 0)],
      [at(7, 4), at(3, 3), at(10, 12), at(1, 12)],
    );
    assert.equal(engineFor(moves).search(fast).move, at(7, 9));
  });

  it('自己能成五時不去擋對手', () => {
    const moves = interleave(
      [at(7, 5), at(7, 6), at(7, 7), at(7, 8), at(0, 0)],
      [at(3, 5), at(3, 6), at(3, 7), at(3, 8), at(7, 4)],
    );
    // 黑方有 (7,9) 可成五
    assert.equal(engineFor(moves).search(fast).move, at(7, 9));
  });

  it('擋活三', () => {
    const moves = interleave([at(7, 6), at(7, 7), at(7, 8)], [at(0, 14), at(14, 0)]);
    const { move } = engineFor(moves).search(fast);
    assert.ok([at(7, 5), at(7, 9), at(7, 4), at(7, 10)].includes(move), `實際 ${move}`);
  });

  it('找到連續衝四', () => {
    // 黑有兩組交叉的眠三，下在交點 (8,5) 就是雙四
    const moves = interleave(
      [at(5, 5), at(6, 5), at(7, 5), at(8, 6), at(8, 7), at(8, 8)],
      [at(4, 5), at(8, 9), at(0, 0), at(0, 14), at(14, 14), at(14, 0)],
    );
    const engine = engineFor(moves);
    const line = engine.findVcf(BLACK, 10);
    assert.ok(line, '應該找到 VCF');
    const game = Game.fromMoves({ size: 15, rule: 'freestyle' }, moves);
    for (const move of line) assert.equal(game.play(move), null);
    assert.equal(game.result?.winner, BLACK);
  });

  it('沒有四可衝時不會誤報 VCF', () => {
    assert.equal(engineFor([at(7, 7), at(0, 0)]).findVcf(BLACK, 10), null);
  });

  it('增量評估與重算一致', () => {
    const moves = [at(7, 7), at(7, 8), at(8, 8), at(6, 6), at(9, 9), at(10, 10), at(8, 7)];
    const engine = engineFor(moves);
    const before = engine.search(fast);
    engine.setPosition(moves);
    const after = engine.search(fast);
    assert.equal(before.move, after.move);
    engine.setPosition([]);
    assert.equal(
      engine.board.some((value) => value !== 0),
      false,
    );
  });
});

describe('對局完整性', () => {
  for (const rule of ['freestyle', 'standard', 'renju'] as const) {
    it(`${rule}：自我對弈全程合法`, () => {
      const engine = new Engine(15, rule);
      for (let round = 0; round < 2; round++) {
        const game = new Game({ size: 15, rule });
        while (!game.result) {
          engine.setPosition(game.moves);
          const { move } = engine.search({ ...LEVEL_LIMITS.easy, timeMs: 30 });
          if (game.turn === BLACK && rule === 'renju') {
            assert.equal(findForbidden(game.board, 15, move), null, '黑棋不可下禁手');
          }
          assert.equal(game.play(move), null);
        }
      }
    });
  }

  it('所有難度都能在 19 路棋盤上回應', () => {
    for (const level of AI_LEVELS) {
      const engine = new Engine(19, 'freestyle');
      engine.setPosition([180, 181, 200]);
      const limits = { ...LEVEL_LIMITS[level], timeMs: 40 };
      const { move } = engine.search(limits);
      assert.ok(move >= 0 && move < 361 && engine.board[move] === 0);
    }
  });
});

describe('賽後分析', () => {
  const config = { size: 15, rule: 'freestyle' } as const;
  const stones = (row: number, cols: number[]): number[] => cols.map((col) => at(row, col));

  it('致勝的一手是最佳著，勝率直接到 100%', () => {
    const moves = interleave(stones(7, [3, 4, 5, 6, 7]), stones(0, [0, 2, 4, 6]));
    const reviews = reviewGame(config, moves);
    assert.equal(reviews.length, moves.length);
    assert.equal(reviews.at(-1)?.blackChance, 1);
    assert.equal(reviews.at(-1)?.quality, 'best');
  });

  it('白棋獲勝時勝率到 0%', () => {
    const moves = interleave(
      [at(0, 0), at(0, 2), at(0, 4), at(0, 6), at(14, 14)],
      stones(7, [3, 4, 5, 6, 7]),
    );
    assert.equal(reviewGame(config, moves).at(-1)?.blackChance, 0);
  });

  it('能成五卻沒成五要標為錯過勝機', () => {
    const blacks = stones(7, [3, 4, 5, 6]);
    const whites = stones(0, [0, 2, 4]);
    // 白擋住一端，黑只剩 (7,7) 能成五，卻下到角落
    const blocked = interleave(blacks, [...whites, at(7, 2)]);
    const reviews = reviewGame(config, [...blocked, at(14, 14)]);
    assert.equal(reviews.at(-1)?.quality, 'missed-win');
    assert.equal(reviews.at(-1)?.suggestion, at(7, 7));
  });

  it('分數換算在兩端收斂', () => {
    assert.equal(chanceFromScore(0), 0.5);
    assert.equal(chanceFromScore(999_999_000), 1);
    assert.equal(chanceFromScore(-999_999_000), 0);
  });
});
