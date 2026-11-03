import { cellOf, findForbidden, findWinningLine } from './rules.ts';
import type {
  BoardSize,
  EndReason,
  ForbiddenReason,
  GameResult,
  MoveRejection,
  RuleSet,
  Stone,
} from './types.ts';
import { BLACK, EMPTY, opponentOf, stoneAtPly } from './types.ts';

export interface GameConfig {
  size: BoardSize;
  rule: RuleSet;
}

export const DEFAULT_CONFIG: GameConfig = { size: 15, rule: 'freestyle' };

/**
 * 一盤棋的權威狀態。整盤棋都由 moves 這個序列決定，
 * 所以悔棋、復盤、線上同步與棋譜匯入都走同一條路徑。
 */
export class Game {
  readonly size: BoardSize;
  readonly rule: RuleSet;
  readonly board: Uint8Array;
  private readonly history: number[] = [];
  private ending: GameResult | null = null;

  constructor(config: GameConfig = DEFAULT_CONFIG) {
    this.size = config.size;
    this.rule = config.rule;
    this.board = new Uint8Array(config.size * config.size);
  }

  static fromMoves(config: GameConfig, moves: readonly number[]): Game {
    const game = new Game(config);
    for (const move of moves) {
      const rejection = game.play(move);
      if (rejection) throw new Error(`第 ${game.moves.length + 1} 手不合法：${rejection}`);
    }
    return game;
  }

  get config(): GameConfig {
    return { size: this.size, rule: this.rule };
  }

  get moves(): readonly number[] {
    return this.history;
  }

  get turn(): Stone {
    return stoneAtPly(this.history.length);
  }

  get result(): GameResult | null {
    return this.ending;
  }

  get lastMove(): number | null {
    return this.history.at(-1) ?? null;
  }

  /** 這一手下在 cell 會被拒絕的原因；可以下則回傳 null。 */
  rejectionOf(cell: number): MoveRejection | null {
    if (this.ending) return 'over';
    if (!Number.isInteger(cell) || cell < 0 || cell >= this.board.length) return 'out-of-bounds';
    if (this.board[cell] !== EMPTY) return 'occupied';
    if (this.rule === 'renju' && this.turn === BLACK) {
      return findForbidden(this.board, this.size, cell);
    }
    return null;
  }

  forbiddenAt(cell: number): ForbiddenReason | null {
    if (this.rule !== 'renju' || this.turn !== BLACK || this.ending) return null;
    return findForbidden(this.board, this.size, cell);
  }

  /** 目前輪到黑棋時，棋盤上所有的禁手點。 */
  forbiddenCells(): Map<number, ForbiddenReason> {
    const cells = new Map<number, ForbiddenReason>();
    if (this.rule !== 'renju' || this.turn !== BLACK || this.ending) return cells;
    for (let cell = 0; cell < this.board.length; cell++) {
      if (this.board[cell] !== EMPTY) continue;
      const reason = findForbidden(this.board, this.size, cell);
      if (reason) cells.set(cell, reason);
    }
    return cells;
  }

  /** 落子。合法時回傳 null，否則回傳拒絕原因且不改變狀態。 */
  play(cell: number): MoveRejection | null {
    const rejection = this.rejectionOf(cell);
    if (rejection) return rejection;
    const stone = this.turn;
    this.board[cell] = stone;
    this.history.push(cell);
    const line = findWinningLine(this.board, this.size, cell, this.rule);
    if (line) this.ending = { winner: stone, reason: 'five', line };
    else if (this.history.length === this.board.length) {
      this.ending = { winner: null, reason: 'draw', line: [] };
    }
    return null;
  }

  /** 收回最後一手。 */
  undo(): number | null {
    const cell = this.history.pop();
    if (cell === undefined) return null;
    this.board[cell] = EMPTY;
    this.ending = null;
    return cell;
  }

  /** 以非棋盤因素結束（認輸、超時）。 */
  conclude(loser: Stone, reason: Extract<EndReason, 'resign' | 'timeout'>): void {
    if (this.ending) return;
    this.ending = { winner: opponentOf(loser), reason, line: [] };
  }

  at(row: number, col: number): number {
    return this.board[cellOf(row, col, this.size)] ?? EMPTY;
  }
}
