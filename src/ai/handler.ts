import { reviewGame } from './analysis.ts';
import { Engine } from './engine.ts';
import type { AiRequest, AiResponse } from './protocol.ts';

let cached: { key: string; engine: Engine } | null = null;

function engineFor(size: number, rule: AiRequest['config']['rule']): Engine {
  const key = `${size}-${rule}`;
  if (cached?.key !== key) cached = { key, engine: new Engine(size, rule) };
  return cached.engine;
}

/** 執行一個 AI 請求。Worker 與主執行緒備援共用這段。 */
export function handleRequest(request: AiRequest, send: (message: AiResponse) => void): void {
  try {
    if (request.kind === 'search') {
      const engine = engineFor(request.config.size, request.config.rule);
      engine.setPosition(request.moves);
      send({ id: request.id, kind: 'search', outcome: engine.search(request.limits) });
    } else {
      const reviews = reviewGame(request.config, request.moves, (done, total) =>
        send({ id: request.id, kind: 'review-progress', done, total }),
      );
      send({ id: request.id, kind: 'review', reviews });
    }
  } catch (error) {
    send({ id: request.id, kind: 'error', message: String(error) });
  }
}
