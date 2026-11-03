/// <reference lib="webworker" />
import { handleRequest } from './handler.ts';
import type { AiRequest } from './protocol.ts';

addEventListener('message', (event: MessageEvent<AiRequest>) => {
  handleRequest(event.data, (message) => postMessage(message));
});
