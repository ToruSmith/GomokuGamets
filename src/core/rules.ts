import type { CellValue, ForbiddenReason, RuleSet, Stone } from './types.ts';
import { BLACK, EMPTY } from './types.ts';

/**
 * 規則判定。棋盤以一維陣列表示，索引為 row * size + col。
 * 這個檔案不依賴 DOM，UI、AI Worker、線上對戰與測試共用同一份邏輯。
 */

export type Board = Uint8Array | Int8Array;

/** 四個方向：橫、直、右下斜、左下斜 */
export const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

export const cellOf = (row: number, col: number, size: number): number => row * size + col;
export const rowOf = (cell: number, size: number): number => Math.floor(cell / size);
export const colOf = (cell: number, size: number): number => cell % size;

const inBounds = (row: number, col: number, size: number): boolean =>
  row >= 0 && row < size && col >= 0 && col < size;

/** 回傳通過 cell、方向為 (dr, dc) 的連續同色棋子（含 cell 本身），依棋盤順序排列。 */
function runThrough(board: Board, size: number, cell: number, dr: number, dc: number): number[] {
  const stone = board[cell];
  const row = rowOf(cell, size);
  const col = colOf(cell, size);
  const before: number[] = [];
  const after: number[] = [];
  for (let r = row - dr, c = col - dc; inBounds(r, c, size); r -= dr, c -= dc) {
    const next = cellOf(r, c, size);
    if (board[next] !== stone) break;
    before.unshift(next);
  }
  for (let r = row + dr, c = col + dc; inBounds(r, c, size); r += dr, c += dc) {
    const next = cellOf(r, c, size);
    if (board[next] !== stone) break;
    after.push(next);
  }
  return [...before, cell, ...after];
}

const winsWithLength = (length: number, stone: Stone, rule: RuleSet): boolean => {
  if (length < 5) return false;
  if (length === 5) return true;
  if (rule === 'freestyle') return true;
  // 連珠的白棋長連算勝；標準規則與連珠黑棋的長連都不算
  return rule === 'renju' && stone !== BLACK;
};

/** cell 上的棋子是否成五。成五時回傳連線格子，否則回傳 null。 */
export function findWinningLine(
  board: Board,
  size: number,
  cell: number,
  rule: RuleSet,
): number[] | null {
  const stone = board[cell] as CellValue;
  if (stone === EMPTY) return null;
  for (const [dr, dc] of DIRECTIONS) {
    const run = runThrough(board, size, cell, dr, dc);
    if (winsWithLength(run.length, stone, rule)) return run;
  }
  return null;
}

/* ─────────────── 連珠禁手 ─────────────── */

/** 空點 cell 在 (dr, dc) 這條線上、前後 steps 格內的所有空點 */
function emptiesNear(
  board: Board,
  size: number,
  cell: number,
  dr: number,
  dc: number,
  steps: number,
): number[] {
  const row = rowOf(cell, size);
  const col = colOf(cell, size);
  const found: number[] = [];
  for (let i = -steps; i <= steps; i++) {
    if (i === 0) continue;
    const r = row + dr * i;
    const c = col + dc * i;
    if (!inBounds(r, c, size)) continue;
    const next = cellOf(r, c, size);
    if (board[next] === EMPTY) found.push(next);
  }
  return found;
}

/** 假設黑棋多下 extra 這一子後，是否在這條線上形成剛好五連且包含 cell。 */
function makesExactFive(
  board: Board,
  size: number,
  cell: number,
  extra: number,
  dr: number,
  dc: number,
): boolean {
  board[extra] = BLACK;
  const run = runThrough(board, size, extra, dr, dc);
  board[extra] = EMPTY;
  return run.length === 5 && run.includes(cell);
}

/**
 * 黑棋已下在 cell，計算這條線上有幾個「四」。
 * 活四（.XXXX.）雖有兩個成五點，仍只算一個四；
 * X.XXX.X 這類同線雙四則算兩個。
 */
function countFoursOnLine(
  board: Board,
  size: number,
  cell: number,
  dr: number,
  dc: number,
): number {
  const fivePoints = emptiesNear(board, size, cell, dr, dc, 4).filter((point) =>
    makesExactFive(board, size, cell, point, dr, dc),
  );
  if (fivePoints.length < 2) return fivePoints.length;
  const [first, second] = fivePoints as [number, number];
  // 兩個成五點間距 5 格且中間全是黑子，就是活四
  const gap = Math.max(
    Math.abs(rowOf(first, size) - rowOf(second, size)),
    Math.abs(colOf(first, size) - colOf(second, size)),
  );
  if (gap === 5 && fivePoints.length === 2) {
    const run = runThrough(board, size, cell, dr, dc);
    if (run.length === 4) return 1;
  }
  return fivePoints.length;
}

/** 目前線上包含 cell 的連續四子，是否兩端都能剛好成五（活四） */
function isStraightFour(board: Board, size: number, cell: number, dr: number, dc: number): boolean {
  const run = runThrough(board, size, cell, dr, dc);
  if (run.length !== 4) return false;
  const first = run[0] as number;
  const last = run[3] as number;
  const r0 = rowOf(first, size) - dr;
  const c0 = colOf(first, size) - dc;
  const r1 = rowOf(last, size) + dr;
  const c1 = colOf(last, size) + dc;
  if (!inBounds(r0, c0, size) || !inBounds(r1, c1, size)) return false;
  const a = cellOf(r0, c0, size);
  const b = cellOf(r1, c1, size);
  return (
    board[a] === EMPTY &&
    board[b] === EMPTY &&
    makesExactFive(board, size, cell, a, dr, dc) &&
    makesExactFive(board, size, cell, b, dr, dc)
  );
}

/** 黑棋已下在 cell，這條線上是否有「活三」：再下一子能形成活四，且那一子本身不是禁手。 */
function hasLiveThreeOnLine(
  board: Board,
  size: number,
  cell: number,
  dr: number,
  dc: number,
  depth: number,
): boolean {
  for (const point of emptiesNear(board, size, cell, dr, dc, 3)) {
    board[point] = BLACK;
    const straight = isStraightFour(board, size, cell, dr, dc);
    board[point] = EMPTY;
    if (straight && (depth <= 0 || findForbidden(board, size, point, depth - 1) === null)) {
      return true;
    }
  }
  return false;
}

/**
 * 判斷黑棋下在空點 cell 是否為禁手；不是禁手時回傳 null。
 * 成五優先於禁手：同時成五又形成雙三，仍是合法勝著。
 * depth 限制「活三判定 → 下一子是否禁手」的遞迴深度。
 */
export function findForbidden(
  board: Board,
  size: number,
  cell: number,
  depth = 3,
): ForbiddenReason | null {
  if (board[cell] !== EMPTY) return null;
  board[cell] = BLACK;
  try {
    let overline = false;
    for (const [dr, dc] of DIRECTIONS) {
      const length = runThrough(board, size, cell, dr, dc).length;
      if (length === 5) return null;
      if (length > 5) overline = true;
    }
    if (overline) return 'overline';

    let fours = 0;
    let threes = 0;
    for (const [dr, dc] of DIRECTIONS) {
      const foursHere = countFoursOnLine(board, size, cell, dr, dc);
      fours += foursHere;
      // 同一條線已經是四，就不再算三
      if (foursHere === 0 && hasLiveThreeOnLine(board, size, cell, dr, dc, depth)) threes++;
    }
    if (fours >= 2) return 'double-four';
    if (threes >= 2) return 'double-three';
    return null;
  } finally {
    board[cell] = EMPTY;
  }
}
