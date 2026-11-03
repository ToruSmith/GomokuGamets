import { FirebaseBackend } from './firebase-backend.ts';
import type { RoomBackend } from './types.ts';

declare const __ROOM_BACKEND__: 'firebase' | 'local' | 'none';

export const onlineAvailable: boolean = __ROOM_BACKEND__ !== 'none';

let backend: RoomBackend | null = null;

export async function roomBackend(): Promise<RoomBackend> {
  if (backend) return backend;
  if (__ROOM_BACKEND__ === 'local') {
    const { LocalBackend } = await import('./local-backend.ts');
    backend = new LocalBackend();
  } else {
    backend = new FirebaseBackend();
  }
  return backend;
}
