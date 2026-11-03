import { decodeRecord, encodeRecord } from '../core/notation.ts';
import type { GameRecord } from '../core/notation.ts';
import { t } from '../i18n/index.ts';
import { normaliseRoomCode } from '../online/session.ts';
import { OnlineMatch, ReviewMatch } from '../state/match.ts';
import type { Match } from '../state/match.ts';
import { settings } from '../state/settings.ts';
import { signal } from '../state/signal.ts';
import { toast } from './widgets.ts';

export type Route =
  | { name: 'home' }
  | { name: 'setup'; mode: 'ai' | 'local' }
  | { name: 'online' }
  | { name: 'play' }
  | { name: 'puzzles' }
  | { name: 'records' }
  | { name: 'settings' }
  | { name: 'help' };

export const route = signal<Route>({ name: 'home' });
export const match = signal<Match | null>(null);

export function setHash(hash: string): void {
  try {
    history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
  } catch {
    // 內嵌環境可能不允許改網址，不影響遊戲
  }
}

export function startMatch(next: Match): void {
  match.peek()?.dispose();
  if (next.kind !== 'review' && next.kind !== 'online') setHash('');
  match.value = next;
  route.value = { name: 'play' };
}

export function goHome(): void {
  match.peek()?.dispose();
  match.value = null;
  setHash('');
  route.value = { name: 'home' };
}

export const displayName = (): string =>
  (
    settings.peek().name.trim() || t('player.guest', { n: Math.floor(Math.random() * 900) + 100 })
  ).slice(0, 16);

export async function joinRoom(code: string): Promise<string | null> {
  const room = new OnlineMatch();
  try {
    const error = await room.join(code, displayName());
    if (error === 'not-found') return t('online.error.notFound');
  } catch (error) {
    console.error(error);
    return t('online.error.connect');
  }
  setHash(`/r/${code}`);
  startMatch(room);
  return null;
}

export function openRecord(record: GameRecord): void {
  setHash(`/g/${encodeRecord(record)}`);
  startMatch(new ReviewMatch(record, record.moves));
}

/** 從分享連結或邀請連結直接進入。 */
export function openFromHash(): void {
  const hash = location.hash.slice(1);
  const roomCode = hash.startsWith('/r/') ? normaliseRoomCode(hash.slice(3)) : null;
  if (roomCode) {
    if (match.peek()?.kind === 'online') return;
    void joinRoom(roomCode).then((error) => {
      if (error) {
        toast(error);
        goHome();
      }
    });
    return;
  }
  if (hash.startsWith('/g/')) {
    const record = decodeRecord(hash.slice(3));
    if (record) openRecord(record);
    else toast(t('records.importError'));
  }
}
