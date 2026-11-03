import { firebaseConfig } from './firebase-config.ts';
import type { RoomBackend, RoomData, Seat } from './types.ts';

/**
 * SDK 只有在進入線上對戰時才從 CDN 載入，
 * 單機與 AI 模式完全不需要網路，首頁也不必背著 Firebase 的體積。
 */
const SDK = 'https://www.gstatic.com/firebasejs/10.7.1';

interface DbRef {
  readonly key: string | null;
}
interface DataSnapshot {
  exists(): boolean;
  val(): unknown;
  forEach(callback: (child: DataSnapshot & { key: string }) => void): void;
}
interface DatabaseSdk {
  getDatabase(app: unknown): unknown;
  ref(db: unknown, path?: string): DbRef;
  get(target: unknown): Promise<DataSnapshot>;
  set(target: DbRef, value: unknown): Promise<void>;
  update(target: DbRef, value: Record<string, unknown>): Promise<void>;
  remove(target: DbRef): Promise<void>;
  onValue(target: DbRef, listener: (snapshot: DataSnapshot) => void): () => void;
  onDisconnect(target: DbRef): { set(value: unknown): Promise<void> };
  query(target: DbRef, ...constraints: unknown[]): unknown;
  orderByChild(path: string): unknown;
  limitToFirst(count: number): unknown;
}

const importSdk = <T>(file: string): Promise<T> =>
  import(/* @vite-ignore */ `${SDK}/${file}`) as Promise<T>;

export class FirebaseBackend implements RoomBackend {
  private sdk: DatabaseSdk | null = null;
  private db: unknown = null;
  private uid: string | null = null;

  async signIn(): Promise<string> {
    if (this.uid) return this.uid;
    const [{ initializeApp }, sdk, { getAuth, signInAnonymously }] = await Promise.all([
      importSdk<{ initializeApp(config: object): unknown }>('firebase-app.js'),
      importSdk<DatabaseSdk>('firebase-database.js'),
      importSdk<{
        getAuth(app: unknown): unknown;
        signInAnonymously(auth: unknown): Promise<{ user: { uid: string } }>;
      }>('firebase-auth.js'),
    ]);
    const app = initializeApp(firebaseConfig);
    this.sdk = sdk;
    this.db = sdk.getDatabase(app);
    const credential = await signInAnonymously(getAuth(app));
    this.uid = credential.user.uid;
    return this.uid;
  }

  private target(path: string): DbRef {
    if (!this.sdk) throw new Error('尚未登入');
    return this.sdk.ref(this.db, path);
  }

  private get api(): DatabaseSdk {
    if (!this.sdk) throw new Error('尚未登入');
    return this.sdk;
  }

  async read(code: string): Promise<RoomData | null> {
    const snapshot = await this.api.get(this.target(`rooms/${code}`));
    return snapshot.exists() ? (snapshot.val() as RoomData) : null;
  }

  create(code: string, room: RoomData): Promise<void> {
    return this.api.set(this.target(`rooms/${code}`), room);
  }

  update(code: string, patch: Record<string, unknown>): Promise<void> {
    return this.api.update(this.target(`rooms/${code}`), patch);
  }

  watch(code: string, listener: (room: RoomData | null) => void): () => void {
    return this.api.onValue(this.target(`rooms/${code}`), (snapshot) =>
      listener(snapshot.exists() ? (snapshot.val() as RoomData) : null),
    );
  }

  async markPresent(code: string, seat: Seat): Promise<void> {
    const target = this.target(`rooms/${code}/presence/${seat}`);
    await this.api.onDisconnect(target).set(false);
    await this.api.set(target, true);
  }

  remove(code: string): Promise<void> {
    return this.api.remove(this.target(`rooms/${code}`));
  }

  async sweepStale(): Promise<void> {
    const { query, orderByChild, limitToFirst, get } = this.api;
    const oldest = query(this.target('rooms'), orderByChild('createdAt'), limitToFirst(10));
    const snapshot = await get(oldest);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const stale: string[] = [];
    snapshot.forEach((child) => {
      if ((child.val() as RoomData).createdAt < dayAgo) stale.push(child.key);
    });
    await Promise.allSettled(stale.map((code) => this.remove(code)));
  }
}
