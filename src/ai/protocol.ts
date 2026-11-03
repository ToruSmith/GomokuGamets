import type { GameConfig } from '../core/game.ts';
import type { MoveReview } from './analysis.ts';
import type { SearchLimits, SearchOutcome } from './engine.ts';

export type AiRequest =
  | { id: number; kind: 'search'; config: GameConfig; moves: number[]; limits: SearchLimits }
  | { id: number; kind: 'review'; config: GameConfig; moves: number[] };

export type AiResponse =
  | { id: number; kind: 'search'; outcome: SearchOutcome }
  | { id: number; kind: 'review-progress'; done: number; total: number }
  | { id: number; kind: 'review'; reviews: MoveReview[] }
  | { id: number; kind: 'error'; message: string };
