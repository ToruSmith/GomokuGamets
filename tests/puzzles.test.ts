import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '../src/ai/engine.ts';
import { Game } from '../src/core/game.ts';
import { PUZZLES } from '../src/core/puzzle-data.ts';
import type { GameResult } from '../src/core/types.ts';

describe('殘局題', () => {
  PUZZLES.forEach((puzzle, index) => {
    it(`第 ${index + 1} 題：${puzzle.winIn} 手內必勝，且沒有更短的解`, () => {
      const config = { size: 15, rule: 'freestyle' } as const;
      const game = Game.fromMoves(config, puzzle.moves);
      assert.equal(game.result, null);
      const engine = new Engine(15, 'freestyle');
      engine.setPosition(puzzle.moves);
      const solver = game.turn;
      assert.equal(engine.findVcf(solver, puzzle.winIn - 2, 80000), null);
      const line = engine.findVcf(solver, puzzle.winIn - 1, 80000);
      assert.ok(line, '應該有解');
      for (const move of line) assert.equal(game.play(move), null);
      assert.equal((game.result as GameResult | null)?.winner, solver);
    });
  });
});
