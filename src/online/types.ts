import type { GameConfig } from '../core/game.ts';
import type { Stone } from '../core/types.ts';

export type Seat = 'black' | 'white';

export const seatOf = (stone: Stone): Seat => (stone === 1 ? 'black' : 'white');
export const stoneOf = (seat: Seat): Stone => (seat === 'black' ? 1 : 2);
export const otherSeat = (seat: Seat): Seat => (seat === 'black' ? 'white' : 'black');

export interface RoomPlayer {
  uid: string;
  name: string;
}

export interface RoomMove {
  /** 第幾手，從 0 起算 */
  i: number;
  /** 棋盤格索引 */
  c: number;
}

/**
 * Realtime Database 上一個房間的資料。
 * 勝負不存在資料庫：所有客戶端都從 moves 重演得出同樣結果，
 * 所以沒有人能「寫入自己贏了」。唯一能寫的結局是自己認輸。
 */
export interface RoomData {
  createdAt: number;
  config: GameConfig;
  n: number;
  players: Partial<Record<Seat, RoomPlayer>>;
  moves?: Record<string, RoomMove> | (RoomMove | null)[];
  resigned?: Partial<Record<Seat, boolean>>;
  presence?: Partial<Record<Seat, boolean>>;
  rematch?: Partial<Record<Seat, boolean>>;
  reaction?: Partial<Record<Seat, { e: number; t: number }>>;
  next?: string;
}

/** 線上對戰需要的後端能力。正式環境是 Firebase，測試用記憶體版。 */
export interface RoomBackend {
  signIn(): Promise<string>;
  read(code: string): Promise<RoomData | null>;
  create(code: string, room: RoomData): Promise<void>;
  /** 多路徑原子更新，路徑相對於房間 */
  update(code: string, patch: Record<string, unknown>): Promise<void>;
  watch(code: string, listener: (room: RoomData | null) => void): () => void;
  /** 標記上線，並在斷線時自動標記離線 */
  markPresent(code: string, seat: Seat): Promise<void>;
  remove(code: string): Promise<void>;
  /** 順手清掉過期房間，失敗不影響遊戲 */
  sweepStale(): Promise<void>;
}
