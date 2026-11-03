import type { AiLevel } from '../ai/levels.ts';
import type { GameConfig } from '../core/game.ts';
import type { EndReason, Stone } from '../core/types.ts';
import { load, save } from '../platform/storage.ts';
import { signal } from './signal.ts';

export interface GameLog extends GameConfig {
  id: string;
  playedAt: number;
  kind: 'ai' | 'local' | 'online';
  moves: number[];
  winner: Stone | null;
  reason: EndReason;
  /** 玩家執的顏色；雙人同機為 null */
  human: Stone | null;
  level?: AiLevel;
  opponent?: string;
}

const LIMIT = 200;

export const gameLogs = signal<GameLog[]>(load('logs', []));

export function addGameLog(entry: GameLog): void {
  gameLogs.value = [entry, ...gameLogs.peek()].slice(0, LIMIT);
  save('logs', gameLogs.peek());
}

export function removeGameLog(id: string): void {
  gameLogs.value = gameLogs.peek().filter((log) => log.id !== id);
  save('logs', gameLogs.peek());
}

export interface LevelStats {
  wins: number;
  losses: number;
}

export function statsByLevel(logs: readonly GameLog[]): Map<AiLevel, LevelStats> {
  const stats = new Map<AiLevel, LevelStats>();
  for (const log of logs) {
    if (log.kind !== 'ai' || !log.level || log.winner === null) continue;
    const entry = stats.get(log.level) ?? { wins: 0, losses: 0 };
    if (log.winner === log.human) entry.wins++;
    else entry.losses++;
    stats.set(log.level, entry);
  }
  return stats;
}

export const solvedPuzzles = signal<number[]>(load('solved', []));

export function markPuzzleSolved(index: number): void {
  if (solvedPuzzles.peek().includes(index)) return;
  solvedPuzzles.value = [...solvedPuzzles.peek(), index];
  save('solved', solvedPuzzles.peek());
}
