import { Engine, isMateScore } from './engine.ts';
import { ANALYSIS_LIMITS } from './levels.ts';
import { Game } from '../core/game.ts';
import type { GameConfig } from '../core/game.ts';
import { BLACK, WHITE } from '../core/types.ts';

export type MoveQuality = 'best' | 'good' | 'inaccuracy' | 'blunder' | 'missed-win';

export interface MoveReview {
  ply: number;
  /** 下完這手後黑方的勝率估計（0 到 1） */
  blackChance: number;
  quality: MoveQuality;
  /** 這手之前 AI 建議的著手 */
  suggestion: number;
}

/** 把搜尋分數換成勝率估計。常數是依評估函式的分數尺度抓的，只作視覺呈現。 */
export function chanceFromScore(score: number): number {
  if (isMateScore(score)) return score > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-score / 900));
}

/** 目前局面黑方勝率：包含雙方是否已有連續衝四必勝。 */
function evaluate(engine: Engine, moves: readonly number[]) {
  engine.setPosition(moves);
  const outcome = engine.search(ANALYSIS_LIMITS);
  const stone = moves.length % 2 === 0 ? BLACK : WHITE;
  const blackScore = stone === BLACK ? outcome.score : -outcome.score;
  return { outcome, blackChance: chanceFromScore(blackScore), stone };
}

/** 逐手複盤。每手都要搜尋，所以用 onProgress 回報進度。 */
export function reviewGame(
  config: GameConfig,
  moves: readonly number[],
  onProgress?: (done: number, total: number) => void,
): MoveReview[] {
  const engine = new Engine(config.size, config.rule);
  const reviews: MoveReview[] = [];
  const game = new Game(config);
  let before = evaluate(engine, []);
  for (let ply = 0; ply < moves.length; ply++) {
    const played = moves[ply] as number;
    game.play(played);
    // 這手直接分出勝負：引擎看的是「還能下」的局面，不能交給它評估
    if (game.result) {
      const winner = game.result.winner;
      reviews.push({
        ply,
        blackChance: winner === null ? 0.5 : winner === BLACK ? 1 : 0,
        quality: 'best',
        suggestion: before.outcome.move,
      });
      onProgress?.(ply + 1, moves.length);
      break;
    }
    const after = evaluate(engine, moves.slice(0, ply + 1));
    const mover = before.stone;
    const moverBefore = mover === BLACK ? before.blackChance : 1 - before.blackChance;
    const moverAfter = mover === BLACK ? after.blackChance : 1 - after.blackChance;
    const loss = moverBefore - moverAfter;

    let quality: MoveQuality = 'good';
    if (played === before.outcome.move) quality = 'best';
    else if (before.outcome.forcedWin && moverAfter < 0.98) quality = 'missed-win';
    else if (loss > 0.35) quality = 'blunder';
    else if (loss > 0.18) quality = 'inaccuracy';

    reviews.push({
      ply,
      blackChance: after.blackChance,
      quality,
      suggestion: before.outcome.move,
    });
    onProgress?.(ply + 1, moves.length);
    before = after;
  }
  return reviews;
}
