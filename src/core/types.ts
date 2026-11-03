/** 棋盤上的格子內容：0 空、1 黑、2 白。 */
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Stone = typeof BLACK | typeof WHITE;
export type CellValue = typeof EMPTY | Stone;

/**
 * 規則組：
 * - freestyle：五連以上皆勝（一般人最熟悉的玩法）
 * - standard：只有剛好五連才算勝，長連不算
 * - renju：連珠，黑棋有三三、四四、長連禁手，白棋長連也算勝
 */
export type RuleSet = 'freestyle' | 'standard' | 'renju';

export const BOARD_SIZES = [13, 15, 19] as const;
export type BoardSize = (typeof BOARD_SIZES)[number];

export type ForbiddenReason = 'overline' | 'double-three' | 'double-four';

export type EndReason = 'five' | 'draw' | 'resign' | 'timeout';

export interface GameResult {
  /** null 代表平局 */
  winner: Stone | null;
  reason: EndReason;
  /** 連成一線的格子，只有 reason === 'five' 時才有 */
  line: number[];
}

export type MoveRejection = 'over' | 'occupied' | 'out-of-bounds' | ForbiddenReason;

export const opponentOf = (stone: Stone): Stone => (stone === BLACK ? WHITE : BLACK);

/** 第 n 手（從 0 起算）由誰下：黑先，之後輪流。 */
export const stoneAtPly = (ply: number): Stone => (ply % 2 === 0 ? BLACK : WHITE);
