import { colOf, rowOf } from './rules.ts';
import { Game } from './game.ts';
import type { GameConfig } from './game.ts';
import { BOARD_SIZES } from './types.ts';
import type { BoardSize, RuleSet } from './types.ts';

/** 座標採常見的棋譜寫法：欄為 A 起算的字母，列由下往上數，例如天元是 H8。 */
export function cellName(cell: number, size: number): string {
  const column = String.fromCharCode(65 + colOf(cell, size));
  return `${column}${size - rowOf(cell, size)}`;
}

export function parseCellName(name: string, size: number): number | null {
  const match = /^([A-Za-z])(\d{1,2})$/.exec(name.trim());
  if (!match) return null;
  const col = (match[1] as string).toUpperCase().charCodeAt(0) - 65;
  const row = size - Number(match[2]);
  if (col < 0 || col >= size || row < 0 || row >= size) return null;
  return row * size + col;
}

const RULE_CODES: Record<RuleSet, string> = { freestyle: 'f', standard: 's', renju: 'r' };
const CODE_RULES: Record<string, RuleSet> = { f: 'freestyle', s: 'standard', r: 'renju' };

export interface GameRecord extends GameConfig {
  moves: number[];
}

/** 把棋局壓成可放進網址的短字串：v1-尺寸-規則-每手兩個 base36 字元 */
export function encodeRecord(record: GameRecord): string {
  const moves = record.moves.map((move) => move.toString(36).padStart(2, '0')).join('');
  return `1-${record.size}-${RULE_CODES[record.rule]}-${moves}`;
}

/** 解析分享連結。內容來自網址，一律當作不可信資料逐手驗證。 */
export function decodeRecord(text: string): GameRecord | null {
  const match = /^1-(\d{2})-([fsr])-([0-9a-z]*)$/.exec(text.trim());
  if (!match) return null;
  const size = Number(match[1]) as BoardSize;
  const rule = CODE_RULES[match[2] as string];
  const body = match[3] as string;
  if (!BOARD_SIZES.includes(size) || !rule || body.length % 2 !== 0) return null;
  const moves: number[] = [];
  for (let i = 0; i < body.length; i += 2) moves.push(parseInt(body.slice(i, i + 2), 36));
  try {
    Game.fromMoves({ size, rule }, moves);
  } catch {
    return null;
  }
  return { size, rule, moves };
}

/** 人類可讀的棋譜文字，例如 H8 I9 G7 */
export function movesToText(moves: readonly number[], size: number): string {
  return moves.map((move) => cellName(move, size)).join(' ');
}

export function movesFromText(text: string, config: GameConfig): number[] | null {
  const tokens = text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const moves: number[] = [];
  for (const token of tokens) {
    const cell = parseCellName(token, config.size);
    if (cell === null) return null;
    moves.push(cell);
  }
  try {
    Game.fromMoves(config, moves);
  } catch {
    return null;
  }
  return moves;
}
