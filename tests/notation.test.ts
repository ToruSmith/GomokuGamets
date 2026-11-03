import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cellName,
  decodeRecord,
  encodeRecord,
  movesFromText,
  movesToText,
  parseCellName,
} from '../src/core/notation.ts';

describe('棋譜', () => {
  it('天元是 H8，四角正確', () => {
    assert.equal(cellName(7 * 15 + 7, 15), 'H8');
    assert.equal(cellName(0, 15), 'A15');
    assert.equal(cellName(224, 15), 'O1');
    assert.equal(parseCellName('h8', 15), 7 * 15 + 7);
    assert.equal(parseCellName('Z1', 15), null);
  });

  it('編碼解碼可還原', () => {
    const record = { size: 19, rule: 'renju', moves: [180, 181, 200, 360] } as const;
    assert.deepEqual(decodeRecord(encodeRecord({ ...record, moves: [...record.moves] })), {
      ...record,
      moves: [...record.moves],
    });
  });

  it('拒絕竄改或不合法的連結', () => {
    assert.equal(decodeRecord('1-15-f-0'), null, '奇數長度');
    assert.equal(decodeRecord('1-16-f-00'), null, '不存在的尺寸');
    assert.equal(decodeRecord('1-15-x-00'), null, '不存在的規則');
    assert.equal(decodeRecord('1-15-f-0000'), null, '重複落子');
    assert.equal(decodeRecord('1-15-f-zz'), null, '超出棋盤');
    assert.equal(decodeRecord('<script>'), null);
  });

  it('文字棋譜可往返', () => {
    const config = { size: 15, rule: 'freestyle' } as const;
    const text = 'H8 I9 G7';
    const moves = movesFromText(text, config);
    assert.ok(moves);
    assert.equal(movesToText(moves, 15), text);
    assert.equal(movesFromText('H8 H8', config), null);
  });
});
