import type { GameConfig } from '../core/game.ts';
import type { MoveReview } from './analysis.ts';
import type { SearchLimits, SearchOutcome } from './engine.ts';
import { handleRequest } from './handler.ts';
import type { AiRequest, AiResponse } from './protocol.ts';
// 建置時由 scripts/build.mjs 把 Worker 打包成字串內嵌進來，
// 部署時不用處理路徑，單檔版也能直接運作。
import workerSource from 'inline-worker:./worker.ts';

interface Pending {
  request: AiRequest;
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  onProgress?: (done: number, total: number) => void;
}

/** 主執行緒備援的思考時間上限，太長畫面會卡住 */
const FALLBACK_TIME_MS = 350;

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

/**
 * 主執行緒端的 AI 介面。取消時直接終止 Worker，舊的結果不可能再回來。
 * 環境禁止 Worker 時（例如嚴格的 CSP）改在主執行緒計算，只是想得比較短。
 */
export class AiClient {
  private worker: Worker | null = null;
  private workerBlocked = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  private ensureWorker(): Worker | null {
    if (this.worker || this.workerBlocked) return this.worker;
    try {
      const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
      const worker = new Worker(url);
      worker.onmessage = (event: MessageEvent<AiResponse>) => this.handle(event.data);
      worker.onerror = () => this.fallBack();
      this.worker = worker;
    } catch {
      this.workerBlocked = true;
    }
    return this.worker;
  }

  /** Worker 起不來或中途壞掉：把等待中的請求改到主執行緒 */
  private fallBack(): void {
    this.worker?.terminate();
    this.worker = null;
    this.workerBlocked = true;
    for (const entry of this.pending.values()) this.runInline(entry.request);
  }

  private runInline(request: AiRequest): void {
    // 讓瀏覽器先畫出「思考中」，也讓取消有機會生效
    setTimeout(() => {
      if (!this.pending.has(request.id)) return;
      const shortened: AiRequest =
        request.kind === 'search'
          ? {
              ...request,
              limits: {
                ...request.limits,
                timeMs: Math.min(request.limits.timeMs, FALLBACK_TIME_MS),
              },
            }
          : request;
      handleRequest(shortened, (message) => this.handle(message));
    }, 20);
  }

  private handle(message: AiResponse): void {
    const entry = this.pending.get(message.id);
    if (!entry) return;
    if (message.kind === 'review-progress') {
      entry.onProgress?.(message.done, message.total);
      return;
    }
    this.pending.delete(message.id);
    if (message.kind === 'error') entry.reject(new Error(message.message));
    else if (message.kind === 'search') entry.resolve(message.outcome as never);
    else entry.resolve(message.reviews as never);
  }

  private rejectAll(reason: Error): void {
    for (const entry of this.pending.values()) entry.reject(reason);
    this.pending.clear();
  }

  private request<T>(
    body: Omit<AiRequest, 'id'>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<T> {
    const request = { ...body, id: this.nextId++ } as AiRequest;
    const worker = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(request.id, {
        request,
        resolve: resolve as (value: never) => void,
        reject,
        ...(onProgress ? { onProgress } : {}),
      });
      if (worker) worker.postMessage(request);
      else this.runInline(request);
    });
  }

  search(config: GameConfig, moves: readonly number[], limits: SearchLimits) {
    return this.request<SearchOutcome>({
      kind: 'search',
      config,
      moves: [...moves],
      limits,
    } as Omit<AiRequest, 'id'>);
  }

  review(
    config: GameConfig,
    moves: readonly number[],
    onProgress: (done: number, total: number) => void,
  ) {
    return this.request<MoveReview[]>(
      { kind: 'review', config, moves: [...moves] } as Omit<AiRequest, 'id'>,
      onProgress,
    );
  }

  /** 中止所有進行中的運算（重新開始、悔棋、離開時呼叫）。 */
  cancel(): void {
    this.worker?.terminate();
    this.worker = null;
    this.rejectAll(new CancelledError());
  }
}
