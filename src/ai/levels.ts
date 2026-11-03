import type { SearchLimits } from './engine.ts';

export const AI_LEVELS = ['novice', 'easy', 'medium', 'hard', 'master'] as const;
export type AiLevel = (typeof AI_LEVELS)[number];

/** 各難度的搜尋限制。棋力差距來自看得多深，而不是靠故意下壞棋。 */
export const LEVEL_LIMITS: Record<AiLevel, SearchLimits> = {
  novice: {
    timeMs: 80,
    maxDepth: 1,
    width: 12,
    vcfDepth: 0,
    noise: 900,
    guardAgainstVcf: false,
  },
  easy: { timeMs: 120, maxDepth: 2, width: 10, vcfDepth: 0, noise: 260, guardAgainstVcf: false },
  medium: { timeMs: 300, maxDepth: 4, width: 10, vcfDepth: 6, noise: 40, guardAgainstVcf: false },
  hard: { timeMs: 900, maxDepth: 10, width: 12, vcfDepth: 12, noise: 0, guardAgainstVcf: true },
  master: { timeMs: 2500, maxDepth: 16, width: 16, vcfDepth: 18, noise: 0, guardAgainstVcf: true },
};

/** 提示與賽後分析用的設定：固定、不含隨機。 */
export const ANALYSIS_LIMITS: SearchLimits = {
  timeMs: 220,
  maxDepth: 10,
  width: 12,
  vcfDepth: 12,
  noise: 0,
  guardAgainstVcf: false,
};
