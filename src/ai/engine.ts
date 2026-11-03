import { findForbidden, findWinningLine } from '../core/rules.ts';
import type { RuleSet, Stone } from '../core/types.ts';
import { BLACK, EMPTY, WHITE } from '../core/types.ts';

/**
 * 五子棋搜尋引擎。
 *
 * 盤面評估用「五元組」：棋盤上每個長度 5 的窗格都記錄黑白各有幾子，
 * 只含單色的窗格才有價值。落子時只需更新經過該格的窗格（最多 20 個），
 * 所以評估是增量的。
 *
 * 搜尋是迭代加深的負極大值 + alpha-beta，搭配置換表、殺手著與歷史啟發。
 * 必須應對（對手已有四）的節點不消耗深度，連續衝四因此能看得很遠；
 * 根節點另外跑 VCF（連續衝四必勝）搜尋。
 */

const MATE = 1_000_000_000;
const MATE_FLOOR = MATE - 1000;
const MAX_PLY = 64;

/** 窗格內有 n 顆同色棋子時的靜態分數 */
const WINDOW_VALUE = [0, 4, 45, 420, 4200, 0];
/** 候選點排序用：這格補上去會讓有 n 子的窗格變成 n+1 子 */
const MOVE_GAIN = [1, 12, 110, 1200, 20000];

const TT_BITS = 19;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const TT_EXACT = 1;
const TT_LOWER = 2;
const TT_UPPER = 3;

export interface SearchLimits {
  timeMs: number;
  maxDepth: number;
  /** 每層考慮的候選點數 */
  width: number;
  /** VCF 搜尋的攻擊手數，0 代表關閉 */
  vcfDepth: number;
  /** 根節點分數加上的隨機量，越大棋力越弱、棋路越多變 */
  noise: number;
  /** 檢查自己這手會不會讓對手有 VCF */
  guardAgainstVcf: boolean;
}

export interface SearchOutcome {
  move: number;
  /** 從輪到下的一方看的分數 */
  score: number;
  depth: number;
  nodes: number;
  /** 已找到必勝手順（連續衝四）時的完整序列，含雙方 */
  forcedWin: number[] | null;
}

type Random = () => number;

const now = (): number => performance.now();

/** 固定種子的 xorshift，讓 Zobrist 表每次載入都相同 */
function seededInts(count: number): Int32Array {
  const values = new Int32Array(count);
  let state = 0x2f6e2b1;
  for (let i = 0; i < count; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    values[i] = state;
  }
  return values;
}

export class Engine {
  readonly size: number;
  readonly rule: RuleSet;
  readonly board: Uint8Array;
  private readonly cells: number;

  // 窗格資料
  private readonly windowCount: number;
  private readonly windowCells: Int16Array;
  private readonly cellWindowStart: Int32Array;
  private readonly cellWindows: Int32Array;
  private readonly blackInWindow: Int8Array;
  private readonly whiteInWindow: Int8Array;
  private staticScore = 0; // 黑方視角

  // 候選點：near[cell] > 0 表示兩格內有棋子
  private readonly near: Int16Array;
  private readonly neighbours: Int32Array[];
  private stones = 0;

  // 置換表
  private readonly zobristLo: Int32Array;
  private readonly zobristHi: Int32Array;
  private hashLo = 0;
  private hashHi = 0;
  private readonly ttCheck = new Int32Array(TT_SIZE);
  private readonly ttScore = new Int32Array(TT_SIZE);
  private readonly ttMove = new Int16Array(TT_SIZE);
  private readonly ttDepth = new Int8Array(TT_SIZE);
  private readonly ttFlag = new Int8Array(TT_SIZE);

  // 排序啟發
  private readonly killers: Int16Array;
  private readonly history: Int32Array;

  // 每層的候選緩衝
  private readonly moveBuffers: Int16Array[] = [];
  private readonly scoreBuffers: Float64Array[] = [];
  private winningCell = -1;

  private generatedForced = false;

  // 搜尋狀態
  private nodes = 0;
  private deadline = Infinity;
  private aborted = false;
  private width = 16;
  private vcfBudget = 0;
  private readonly vcfSeen = new Set<number>();

  constructor(size: number, rule: RuleSet) {
    this.size = size;
    this.rule = rule;
    this.cells = size * size;
    this.board = new Uint8Array(this.cells);
    this.near = new Int16Array(this.cells);

    const windows: number[] = [];
    const perCell: number[][] = Array.from({ length: this.cells }, () => []);
    const directions = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ] as const;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        for (const [dr, dc] of directions) {
          const endRow = row + dr * 4;
          const endCol = col + dc * 4;
          if (endRow >= size || endCol >= size || endCol < 0) continue;
          const id = windows.length / 5;
          for (let i = 0; i < 5; i++) {
            const cell = (row + dr * i) * size + col + dc * i;
            windows.push(cell);
            (perCell[cell] as number[]).push(id);
          }
        }
      }
    }
    this.windowCount = windows.length / 5;
    this.windowCells = Int16Array.from(windows);
    this.blackInWindow = new Int8Array(this.windowCount);
    this.whiteInWindow = new Int8Array(this.windowCount);
    this.cellWindowStart = new Int32Array(this.cells + 1);
    this.cellWindows = new Int32Array(perCell.reduce((sum, list) => sum + list.length, 0));
    let offset = 0;
    perCell.forEach((list, cell) => {
      this.cellWindowStart[cell] = offset;
      this.cellWindows.set(list, offset);
      offset += list.length;
    });
    this.cellWindowStart[this.cells] = offset;

    this.neighbours = Array.from({ length: this.cells }, (_, cell) => {
      const row = Math.floor(cell / size);
      const col = cell % size;
      const list: number[] = [];
      for (const [dr, dc] of [...directions, [0, -1], [-1, 0], [-1, -1], [-1, 1]] as const) {
        for (let step = 1; step <= 2; step++) {
          const r = row + dr * step;
          const c = col + dc * step;
          if (r >= 0 && r < size && c >= 0 && c < size) list.push(r * size + c);
        }
      }
      return Int32Array.from(list);
    });

    const random = seededInts(this.cells * 4);
    this.zobristLo = random.subarray(0, this.cells * 2);
    this.zobristHi = random.subarray(this.cells * 2);
    this.killers = new Int16Array((MAX_PLY + 2) * 2).fill(-1);
    this.history = new Int32Array(this.cells * 2);
    for (let ply = 0; ply <= MAX_PLY + 1; ply++) {
      this.moveBuffers.push(new Int16Array(this.cells));
      this.scoreBuffers.push(new Float64Array(this.cells));
    }
  }

  /** 依棋譜重建盤面（黑先輪流）。 */
  setPosition(moves: readonly number[]): void {
    while (this.stones > 0) this.clearAll();
    moves.forEach((move, ply) => this.make(move, ply % 2 === 0 ? BLACK : WHITE));
  }

  private clearAll(): void {
    for (let cell = 0; cell < this.cells; cell++) {
      const stone = this.board[cell] as number;
      if (stone !== EMPTY) this.unmake(cell, stone as Stone);
    }
  }

  private get turn(): Stone {
    return this.stones % 2 === 0 ? BLACK : WHITE;
  }

  private make(cell: number, stone: Stone): void {
    const counts = stone === BLACK ? this.blackInWindow : this.whiteInWindow;
    const others = stone === BLACK ? this.whiteInWindow : this.blackInWindow;
    const sign = stone === BLACK ? 1 : -1;
    const { cellWindows } = this;
    const end = this.cellWindowStart[cell + 1] as number;
    for (let i = this.cellWindowStart[cell] as number; i < end; i++) {
      const window = cellWindows[i] as number;
      const mine = counts[window] as number;
      const theirs = others[window] as number;
      if (theirs === 0) {
        this.staticScore +=
          sign * ((WINDOW_VALUE[mine + 1] as number) - (WINDOW_VALUE[mine] as number));
      } else if (mine === 0) {
        // 原本是對手的窗格，現在被擋死
        this.staticScore += sign * (WINDOW_VALUE[theirs] as number);
      }
      counts[window] = mine + 1;
    }
    this.board[cell] = stone;
    this.stones++;
    const around = this.neighbours[cell] as Int32Array;
    for (let i = 0; i < around.length; i++) (this.near[around[i] as number] as number)++;
    const key = cell * 2 + stone - 1;
    this.hashLo ^= this.zobristLo[key] as number;
    this.hashHi ^= this.zobristHi[key] as number;
  }

  private unmake(cell: number, stone: Stone): void {
    const counts = stone === BLACK ? this.blackInWindow : this.whiteInWindow;
    const others = stone === BLACK ? this.whiteInWindow : this.blackInWindow;
    const sign = stone === BLACK ? 1 : -1;
    const { cellWindows } = this;
    const end = this.cellWindowStart[cell + 1] as number;
    for (let i = this.cellWindowStart[cell] as number; i < end; i++) {
      const window = cellWindows[i] as number;
      const mine = (counts[window] as number) - 1;
      const theirs = others[window] as number;
      counts[window] = mine;
      if (theirs === 0) {
        this.staticScore -=
          sign * ((WINDOW_VALUE[mine + 1] as number) - (WINDOW_VALUE[mine] as number));
      } else if (mine === 0) {
        this.staticScore -= sign * (WINDOW_VALUE[theirs] as number);
      }
    }
    this.board[cell] = EMPTY;
    this.stones--;
    const around = this.neighbours[cell] as Int32Array;
    for (let i = 0; i < around.length; i++) (this.near[around[i] as number] as number)--;
    const key = cell * 2 + stone - 1;
    this.hashLo ^= this.zobristLo[key] as number;
    this.hashHi ^= this.zobristHi[key] as number;
  }

  /** 下在 cell 是否真的成五（標準、連珠規則要排除長連）。 */
  private winsAt(cell: number, stone: Stone): boolean {
    if (this.rule === 'freestyle') return true;
    this.board[cell] = stone;
    const line = findWinningLine(this.board, this.size, cell, this.rule);
    this.board[cell] = EMPTY;
    return line !== null;
  }

  private isForbidden(cell: number, stone: Stone): boolean {
    return (
      this.rule === 'renju' &&
      stone === BLACK &&
      findForbidden(this.board, this.size, cell, 2) !== null
    );
  }

  /**
   * 產生候選點並排序，寫入該層緩衝區，回傳數量。
   * 副作用：winningCell（可直接成五的點）、generatedForced（對手有四，只能擋）。
   */
  private generate(stone: Stone, ply: number, preferred: number, width: number): number {
    const mine = stone === BLACK ? this.blackInWindow : this.whiteInWindow;
    const theirs = stone === BLACK ? this.whiteInWindow : this.blackInWindow;
    const moves = this.moveBuffers[ply] as Int16Array;
    const scores = this.scoreBuffers[ply] as Float64Array;
    const killerA = this.killers[ply * 2] as number;
    const killerB = this.killers[ply * 2 + 1] as number;
    const historyBase = stone - 1;
    const { cellWindows, cellWindowStart, board, near, history } = this;

    let count = 0;
    let blocks = 0;
    this.winningCell = -1;

    for (let cell = 0; cell < this.cells; cell++) {
      if (board[cell] !== EMPTY || (near[cell] as number) === 0) continue;
      let attack = 0;
      let defence = 0;
      let five = false;
      let block = false;
      const end = cellWindowStart[cell + 1] as number;
      for (let i = cellWindowStart[cell] as number; i < end; i++) {
        const window = cellWindows[i] as number;
        const m = mine[window] as number;
        const t = theirs[window] as number;
        if (t === 0) {
          if (m === 4) five = true;
          attack += MOVE_GAIN[m] as number;
        }
        if (m === 0) {
          if (t === 4) block = true;
          defence += MOVE_GAIN[t] as number;
        }
      }
      if (five && this.winsAt(cell, stone)) {
        this.winningCell = cell;
        return 0;
      }
      if (block && !this.winsAt(cell, stone === BLACK ? WHITE : BLACK)) block = false;

      let score = attack * 1.15 + defence;
      if (cell === preferred) score += 1e9;
      else if (cell === killerA || cell === killerB) score += 1500;
      score += (history[cell * 2 + historyBase] as number) / 64;

      if (block) {
        // 必須擋：把之前收集的一般候選全部蓋掉
        if (blocks === 0) count = 0;
        blocks++;
        moves[count] = cell;
        scores[count] = score;
        count++;
      } else if (blocks === 0) {
        moves[count] = cell;
        scores[count] = score;
        count++;
      }
    }
    this.generatedForced = blocks > 0;

    // 排序（候選最多數百個）
    for (let i = 1; i < count; i++) {
      const move = moves[i] as number;
      const value = scores[i] as number;
      let j = i - 1;
      while (j >= 0 && (scores[j] as number) < value) {
        moves[j + 1] = moves[j] as number;
        scores[j + 1] = scores[j] as number;
        j--;
      }
      moves[j + 1] = move;
      scores[j + 1] = value;
    }

    if (this.rule === 'renju' && stone === BLACK) {
      let kept = 0;
      for (let i = 0; i < count && kept < width; i++) {
        const move = moves[i] as number;
        // 分數太低的點不可能構成禁手，省去昂貴的判定
        if ((scores[i] as number) < 250 || !this.isForbidden(move, BLACK)) {
          moves[kept] = move;
          scores[kept] = scores[i] as number;
          kept++;
        }
      }
      return kept;
    }
    return Math.min(count, width);
  }

  private evaluate(stone: Stone): number {
    const score = stone === BLACK ? this.staticScore : -this.staticScore;
    return score + 30;
  }

  private negamax(stone: Stone, depth: number, alpha: number, beta: number, ply: number): number {
    this.nodes++;
    if ((this.nodes & 1023) === 0 && now() > this.deadline) this.aborted = true;
    if (this.aborted) return 0;

    const originalAlpha = alpha;
    const slot = this.hashLo & TT_MASK;
    let preferred = -1;
    if (this.ttCheck[slot] === this.hashHi) {
      preferred = this.ttMove[slot] as number;
      if ((this.ttDepth[slot] as number) >= depth && ply > 0) {
        const stored = this.ttScore[slot] as number;
        const adjusted =
          stored > MATE_FLOOR ? stored - ply : stored < -MATE_FLOOR ? stored + ply : stored;
        const flag = this.ttFlag[slot];
        if (flag === TT_EXACT) return adjusted;
        if (flag === TT_LOWER && adjusted >= beta) return adjusted;
        if (flag === TT_UPPER && adjusted <= alpha) return adjusted;
      }
    }

    const count = this.generate(stone, ply, preferred, this.width);
    if (this.winningCell >= 0) return MATE - ply;
    const forced = this.generatedForced;
    if (count === 0) {
      // 棋盤下滿算和；還有空點但無處可下（連珠黑棋只剩禁手）算輸
      return this.stones === this.cells ? 0 : -MATE + ply;
    }
    if ((depth <= 0 && !forced) || ply >= MAX_PLY) return this.evaluate(stone);

    const moves = this.moveBuffers[ply] as Int16Array;
    const next: Stone = stone === BLACK ? WHITE : BLACK;
    let best = -Infinity;
    let bestMove = moves[0] as number;

    for (let i = 0; i < count; i++) {
      const move = moves[i] as number;
      this.make(move, stone);
      const score = -this.negamax(next, forced ? depth : depth - 1, -beta, -alpha, ply + 1);
      this.unmake(move, stone);
      if (this.aborted) return 0;
      if (score > best) {
        best = score;
        bestMove = move;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (this.killers[ply * 2] !== move) {
          this.killers[ply * 2 + 1] = this.killers[ply * 2] as number;
          this.killers[ply * 2] = move;
        }
        (this.history[move * 2 + stone - 1] as number) += depth * depth;
        break;
      }
    }

    const stored = best > MATE_FLOOR ? best + ply : best < -MATE_FLOOR ? best - ply : best;
    this.ttCheck[slot] = this.hashHi;
    this.ttScore[slot] = stored;
    this.ttMove[slot] = bestMove;
    this.ttDepth[slot] = Math.max(depth, 0);
    this.ttFlag[slot] = best <= originalAlpha ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
    return best;
  }

  /* ─────────────── VCF：連續衝四 ─────────────── */

  /** 回傳窗格中尚未落子的格子。 */
  private emptiesIn(window: number): number[] {
    const found: number[] = [];
    for (let i = window * 5; i < window * 5 + 5; i++) {
      const cell = this.windowCells[i] as number;
      if (this.board[cell] === EMPTY) found.push(cell);
    }
    return found;
  }

  /**
   * 攻方是否能靠連續衝四取勝。回傳雙方的手順（第一手為攻方），否則 null。
   * 守方若擋的同時也做成四，攻方下一手就必須先處理，這種情況會被自然剪掉。
   */
  private vcf(attacker: Stone, remaining: number): number[] | null {
    if (this.vcfBudget-- <= 0) return null;
    const defender: Stone = attacker === BLACK ? WHITE : BLACK;
    const mine = attacker === BLACK ? this.blackInWindow : this.whiteInWindow;
    const theirs = attacker === BLACK ? this.whiteInWindow : this.blackInWindow;

    const candidates = new Set<number>();
    let mustBlock = -1;
    for (let window = 0; window < this.windowCount; window++) {
      const m = mine[window] as number;
      const t = theirs[window] as number;
      if (t === 0 && m === 4) {
        const cell = this.emptiesIn(window)[0] as number;
        if (this.winsAt(cell, attacker)) return [cell];
      }
      if (m === 0 && t === 4 && mustBlock < 0) {
        const cell = this.emptiesIn(window)[0] as number;
        if (this.winsAt(cell, defender)) mustBlock = cell;
      }
      if (t === 0 && m === 3) for (const cell of this.emptiesIn(window)) candidates.add(cell);
    }
    if (remaining <= 0) return null;

    const key = (this.hashLo ^ (this.hashHi * 31)) | 0;
    if (this.vcfSeen.has(key)) return null;
    this.vcfSeen.add(key);

    const list = mustBlock >= 0 ? (candidates.has(mustBlock) ? [mustBlock] : []) : [...candidates];
    for (const cell of list) {
      if (this.isForbidden(cell, attacker)) continue;
      this.make(cell, attacker);
      const answer = this.vcfAnswer(cell, attacker, defender, remaining);
      this.unmake(cell, attacker);
      if (answer) return [cell, ...answer];
    }
    return null;
  }

  /** 攻方剛下完 cell，檢查這是不是四，並展開守方唯一的應手。 */
  private vcfAnswer(
    cell: number,
    attacker: Stone,
    defender: Stone,
    remaining: number,
  ): number[] | null {
    const mine = attacker === BLACK ? this.blackInWindow : this.whiteInWindow;
    const theirs = attacker === BLACK ? this.whiteInWindow : this.blackInWindow;
    const blocks = new Set<number>();
    const end = this.cellWindowStart[cell + 1] as number;
    for (let i = this.cellWindowStart[cell] as number; i < end; i++) {
      const window = this.cellWindows[i] as number;
      if ((mine[window] as number) === 4 && (theirs[window] as number) === 0) {
        const point = this.emptiesIn(window)[0] as number;
        if (this.winsAt(point, attacker)) blocks.add(point);
      }
    }
    if (blocks.size === 0) return null;

    // 守方若自己能直接成五，這一手就沒用
    for (let window = 0; window < this.windowCount; window++) {
      if ((theirs[window] as number) === 4 && (mine[window] as number) === 0) {
        const point = this.emptiesIn(window)[0] as number;
        if (this.winsAt(point, defender)) return null;
      }
    }

    if (blocks.size >= 2) {
      // 雙四或活四：守方擋一邊，攻方在另一邊成五
      const [first, second] = [...blocks] as [number, number];
      return [first, second];
    }
    const block = [...blocks][0] as number;
    if (this.isForbidden(block, defender)) {
      // 連珠：白棋衝四的防守點若是黑棋禁手，黑棋無法應對
      return [];
    }
    this.make(block, defender);
    const rest = this.vcf(attacker, remaining - 1);
    this.unmake(block, defender);
    return rest ? [block, ...rest] : null;
  }

  /** 找出輪到 stone 時的 VCF 手順。 */
  findVcf(stone: Stone, depth: number, budget = 40000): number[] | null {
    this.vcfBudget = budget;
    this.vcfSeen.clear();
    return this.vcf(stone, depth);
  }

  /* ─────────────── 對外介面 ─────────────── */

  /** 依目前盤面找出最佳著。 */
  search(limits: SearchLimits, random: Random = Math.random): SearchOutcome {
    const started = now();
    const stone = this.turn;
    this.nodes = 0;
    this.aborted = false;
    this.deadline = Infinity;
    this.width = limits.width;
    this.history.fill(0);
    this.killers.fill(-1);
    this.ttCheck.fill(0);

    if (this.stones === 0) return this.opening(random);
    if (this.stones === 1) return this.secondMove(random);

    const rootCount = this.generate(stone, 0, -1, Math.max(limits.width, 20));
    if (this.winningCell >= 0) {
      return {
        move: this.winningCell,
        score: MATE - 1,
        depth: 1,
        nodes: this.nodes,
        forcedWin: [this.winningCell],
      };
    }
    const rootForced = this.generatedForced;
    const root = Array.from((this.moveBuffers[0] as Int16Array).subarray(0, rootCount));
    if (root.length === 0) {
      const fallback = (this.board as Uint8Array).findIndex((value) => value === EMPTY);
      return { move: fallback, score: 0, depth: 0, nodes: 0, forcedWin: null };
    }

    if (limits.vcfDepth > 0 && !rootForced) {
      const line = this.findVcf(stone, limits.vcfDepth);
      if (line && line.length > 0) {
        return {
          move: line[0] as number,
          score: MATE - line.length,
          depth: line.length,
          nodes: this.nodes,
          forcedWin: line,
        };
      }
    }

    this.deadline = started + limits.timeMs;
    const next: Stone = stone === BLACK ? WHITE : BLACK;
    let bestMove = root[0] as number;
    let bestScore = -Infinity;
    let reached = 0;
    const rootScores = new Map<number, number>();

    for (let depth = 1; depth <= limits.maxDepth; depth++) {
      let alpha = -Infinity;
      let iterationBest = -Infinity;
      let iterationMove = bestMove;
      const scores = new Map<number, number>();
      for (const move of root) {
        this.make(move, stone);
        // 需要雜訊時每手都用完整視窗，分數才有比較意義
        const window = limits.noise > 0 ? Infinity : -alpha;
        const score = -this.negamax(next, depth - 1, -Infinity, window, 1);
        this.unmake(move, stone);
        if (this.aborted) break;
        scores.set(move, score);
        if (score > iterationBest) {
          iterationBest = score;
          iterationMove = move;
        }
        if (score > alpha) alpha = score;
      }
      if (this.aborted) break;
      bestMove = iterationMove;
      bestScore = iterationBest;
      reached = depth;
      rootScores.clear();
      for (const [move, score] of scores) rootScores.set(move, score);
      // 下一輪先搜上一輪最好的
      root.sort((a, b) => (scores.get(b) ?? -Infinity) - (scores.get(a) ?? -Infinity));
      if (Math.abs(bestScore) > MATE_FLOOR) break;
      if (now() - started > limits.timeMs * 0.55) break;
    }

    if (limits.noise > 0 && Math.abs(bestScore) < MATE_FLOOR) {
      let noisyBest = -Infinity;
      for (const [move, score] of rootScores) {
        if (score < -MATE_FLOOR) continue;
        const noisy = score + random() * limits.noise;
        if (noisy > noisyBest) {
          noisyBest = noisy;
          bestMove = move;
        }
      }
    }

    if (limits.guardAgainstVcf && !rootForced) {
      const safe = this.safestMove(stone, bestMove, root, limits);
      if (safe !== bestMove) {
        bestMove = safe;
        bestScore = rootScores.get(safe) ?? bestScore;
      }
    }

    return { move: bestMove, score: bestScore, depth: reached, nodes: this.nodes, forcedWin: null };
  }

  /** 若最佳著會讓對手有 VCF，改選排序靠前、不會被連續衝四擊穿的著手。 */
  private safestMove(
    stone: Stone,
    best: number,
    ordered: readonly number[],
    limits: SearchLimits,
  ): number {
    const opponent: Stone = stone === BLACK ? WHITE : BLACK;
    const allowsVcf = (move: number): boolean => {
      this.make(move, stone);
      const line = this.findVcf(opponent, Math.min(limits.vcfDepth, 12), 6000);
      this.unmake(move, stone);
      return line !== null;
    };
    if (!allowsVcf(best)) return best;
    for (const move of ordered.slice(0, 12)) {
      if (move !== best && !allowsVcf(move)) return move;
    }
    return best;
  }

  private opening(random: Random): SearchOutcome {
    const center = Math.floor(this.size / 2);
    const spread = this.size > 13 && random() < 0.25 ? 1 : 0;
    const row = center + Math.round((random() - 0.5) * 2 * spread);
    const col = center + Math.round((random() - 0.5) * 2 * spread);
    return { move: row * this.size + col, score: 0, depth: 0, nodes: 0, forcedWin: null };
  }

  private secondMove(random: Random): SearchOutcome {
    const placed = this.board.findIndex((value) => value !== EMPTY);
    const row = Math.floor(placed / this.size);
    const col = placed % this.size;
    const options: number[] = [];
    for (const [dr, dc] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ] as const) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= this.size || c >= this.size) continue;
      options.push(r * this.size + c);
    }
    const pick = options[Math.floor(random() * options.length)] as number;
    return { move: pick, score: 0, depth: 0, nodes: 0, forcedWin: null };
  }
}

export const isMateScore = (score: number): boolean => Math.abs(score) > MATE_FLOOR;
