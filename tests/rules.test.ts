import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Game } from '../src/core/game.ts';
import { cellOf, findForbidden, findWinningLine } from '../src/core/rules.ts';
import { BLACK, WHITE } from '../src/core/types.ts';

const SIZE = 15;
const at = (row: number, col: number): number => cellOf(row, col, SIZE);

/** 用字串畫盤面：X 黑、O 白、. 空，第一列對齊 row 參數。 */
function board(rows: string[], startRow = 5, startCol = 3): Uint8Array {
  const cells = new Uint8Array(SIZE * SIZE);
  rows.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      if (ch === 'X') cells[at(startRow + r, startCol + c)] = BLACK;
      if (ch === 'O') cells[at(startRow + r, startCol + c)] = WHITE;
    });
  });
  return cells;
}

describe('勝負判定', () => {
  it('四個方向都能判定五連', () => {
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ] as const) {
      const cells = new Uint8Array(SIZE * SIZE);
      for (let i = 0; i < 5; i++) cells[at(5 + dr * i, 7 + dc * i)] = BLACK;
      const line = findWinningLine(cells, SIZE, at(5 + dr * 2, 7 + dc * 2), 'freestyle');
      assert.equal(line?.length, 5);
    }
  });

  it('自由規則長連算勝，標準規則不算', () => {
    const cells = board(['XXXXXX']);
    assert.ok(findWinningLine(cells, SIZE, at(5, 5), 'freestyle'));
    assert.equal(findWinningLine(cells, SIZE, at(5, 5), 'standard'), null);
  });

  it('連珠：黑長連不算勝，白長連算勝', () => {
    assert.equal(findWinningLine(board(['XXXXXX']), SIZE, at(5, 5), 'renju'), null);
    assert.ok(findWinningLine(board(['OOOOOO']), SIZE, at(5, 5), 'renju'));
  });

  it('棋盤邊界不會折返', () => {
    const cells = new Uint8Array(SIZE * SIZE);
    for (const col of [12, 13, 14]) cells[at(3, col)] = BLACK;
    for (const col of [0, 1]) cells[at(4, col)] = BLACK;
    assert.equal(findWinningLine(cells, SIZE, at(3, 14), 'freestyle'), null);
  });
});

describe('連珠禁手', () => {
  it('雙活三', () => {
    const cells = board([
      '......', //
      '...X..',
      '...X..',
      '.XX...',
      '......',
    ]);
    // 下在 row 8, col 6 形成橫向與直向兩個活三
    assert.equal(findForbidden(cells, SIZE, at(8, 6)), 'double-three');
  });

  it('雙四', () => {
    const cells = board([
      '...X...', //
      '...X...',
      '...X...',
      'XXX....',
      '.......',
    ]);
    assert.equal(findForbidden(cells, SIZE, at(8, 6)), 'double-four');
  });

  it('同線雙四 X.XXX.X', () => {
    assert.equal(findForbidden(board(['X.X.X.X']), SIZE, at(5, 6)), 'double-four');
  });

  it('長連', () => {
    assert.equal(findForbidden(board(['XXX.XX']), SIZE, at(5, 6)), 'overline');
  });

  it('成五優先於禁手', () => {
    const cells = board([
      '....X..', //
      '....X..',
      '.......',
      'XXXX...',
      '....X..',
      '....X..',
    ]);
    // 下在 row 8, col 7：橫向成五，直向長度也是五
    assert.equal(findForbidden(cells, SIZE, at(8, 7)), null);
  });

  it('被白棋擋住的三不是活三', () => {
    const cells = board([
      '...O..', //
      '...X..',
      '...X..',
      '.XX...',
      '......',
    ]);
    assert.equal(findForbidden(cells, SIZE, at(8, 6)), null);
  });

  it('單一活三、活四不是禁手', () => {
    assert.equal(findForbidden(board(['..XX..']), SIZE, at(5, 7)), null);
    assert.equal(findForbidden(board(['..XXX..']), SIZE, at(5, 8)), null);
  });

  it('跳活三也算活三', () => {
    const cells = new Uint8Array(SIZE * SIZE);
    for (const cell of [at(7, 4), at(7, 7), at(5, 5), at(6, 5)]) cells[cell] = BLACK;
    // 下在 (7,5)：橫向 XX.X 是跳活三，直向 XXX 是活三
    assert.equal(findForbidden(cells, SIZE, at(7, 5)), 'double-three');
  });

  it('要成活四的那一子本身是禁手時，這個三不算活三', () => {
    const cells = new Uint8Array(SIZE * SIZE);
    // 橫向 O.XXX.. 只能往右延伸成活四，也就是 (7,8)
    cells[at(7, 3)] = WHITE;
    for (const cell of [at(7, 5), at(7, 6), at(5, 7), at(6, 7)]) cells[cell] = BLACK;
    assert.equal(findForbidden(cells, SIZE, at(7, 7)), 'double-three', '對照組：兩個活三');

    // 讓 (7,8) 變成長連禁手後，橫向就只剩假活三
    for (const row of [4, 5, 6, 8, 9]) cells[at(row, 8)] = BLACK;
    assert.equal(findForbidden(cells, SIZE, at(7, 8)), 'overline');
    assert.equal(findForbidden(cells, SIZE, at(7, 7)), null);
  });
});

describe('Game', () => {
  it('黑先、輪流、終局後不可再下', () => {
    const game = new Game();
    assert.equal(game.turn, BLACK);
    assert.equal(game.play(at(7, 7)), null);
    assert.equal(game.turn, WHITE);
    assert.equal(game.play(at(7, 7)), 'occupied');
    for (const [b, w] of [
      [at(7, 8), at(8, 0)],
      [at(7, 9), at(8, 1)],
      [at(7, 10), at(8, 2)],
    ] as const) {
      game.play(w);
      game.play(b);
    }
    game.play(at(8, 3));
    assert.equal(game.play(at(7, 11)), null);
    assert.equal(game.result?.winner, BLACK);
    assert.deepEqual(game.result?.line.length, 5);
    assert.equal(game.play(at(0, 0)), 'over');
  });

  it('悔棋會清除勝負', () => {
    const game = Game.fromMoves({ size: 15, rule: 'freestyle' }, [
      at(0, 0),
      at(1, 0),
      at(0, 1),
      at(1, 1),
      at(0, 2),
      at(1, 2),
      at(0, 3),
      at(1, 3),
      at(0, 4),
    ]);
    assert.equal(game.result?.winner, BLACK);
    game.undo();
    assert.equal(game.result, null);
    assert.equal(game.turn, BLACK);
  });

  it('連珠模式拒絕黑棋禁手，白棋不受限', () => {
    const game = new Game({ size: 15, rule: 'renju' });
    const seq = [
      at(6, 6),
      at(0, 0),
      at(7, 6),
      at(0, 14),
      at(8, 7),
      at(14, 0),
      at(8, 8),
      at(14, 14),
    ];
    for (const move of seq) assert.equal(game.play(move), null);
    assert.equal(game.turn, BLACK);
    assert.equal(game.play(at(8, 6)), 'double-three');
    assert.equal(game.moves.length, seq.length);
    assert.ok(game.forbiddenCells().has(at(8, 6)));
  });

  it('認輸與超時由對手獲勝', () => {
    const game = new Game();
    game.conclude(BLACK, 'resign');
    assert.equal(game.result?.winner, WHITE);
    assert.equal(game.result?.reason, 'resign');
  });

  it('下滿棋盤為平局', () => {
    const game = new Game({ size: 13, rule: 'freestyle' });
    while (!game.result) {
      // 每手挑第一個不會直接成五的空點；最後一手填滿棋盤後判平局
      const cell = [...game.board.keys()].find((candidate) => {
        if (game.board[candidate] !== 0) return false;
        game.play(candidate);
        const wins = game.result?.reason === 'five';
        game.undo();
        return !wins;
      });
      assert.notEqual(cell, undefined, '這個填法不應走到只剩成五點');
      game.play(cell as number);
    }
    assert.equal(game.moves.length, 169);
    assert.equal(game.result.reason, 'draw');
    assert.equal(game.result.winner, null);
  });
});
