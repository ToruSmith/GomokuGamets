import { Game } from '../core/game.ts';
import type { GameConfig } from '../core/game.ts';
import { stoneAtPly } from '../core/types.ts';
import type { RoomBackend, RoomData, RoomMove, Seat } from './types.ts';
import { otherSeat, seatOf, stoneOf } from './types.ts';

/** 排除 0/O、1/I 這些在聊天軟體裡容易看錯的字元。 */
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('');
}

export function normaliseRoomCode(text: string): string | null {
  // 接受直接貼上邀請連結
  const code = (/#\/r\/([A-Za-z0-9]{6})/.exec(text)?.[1] ?? text).trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

function sortedMoves(room: RoomData): RoomMove[] {
  const entries = Object.values(room.moves ?? {}).filter((move): move is RoomMove => move !== null);
  return entries.sort((a, b) => a.i - b.i);
}

/**
 * 從房間資料重演整盤棋。任何客戶端在任何時刻（包含重新整理、斷線重連）
 * 都能得到同一個結果。竄改出來的不合法棋步直接判該方負。
 */
export function replayRoom(room: RoomData): Game {
  const game = new Game(room.config);
  // 手數跳號（有人只加 n 不落子）或資料缺口時，
  // 該手的棋手判負；規則無法檢查 key，所以在這裡補上
  const moves = sortedMoves(room);
  const expected = Math.max(room.n, moves.length);
  for (let ply = 0; ply < expected; ply++) {
    if (game.result) break;
    const mover = game.turn;
    const move = moves[ply];
    if (move?.i !== ply || game.play(move.c)) {
      game.conclude(mover, 'resign');
      break;
    }
  }
  for (const seat of ['black', 'white'] as const) {
    if (room.resigned?.[seat]) game.conclude(stoneOf(seat), 'resign');
  }
  return game;
}

export type JoinError = 'not-found' | 'unavailable';

export interface RoomView {
  code: string;
  room: RoomData;
  game: Game;
  /** 我的座位；觀戰者為 null */
  seat: Seat | null;
  opponentOnline: boolean;
  opponentJoined: boolean;
  myTurn: boolean;
}

/** 一場線上對局的完整生命週期，與 UI 無關。 */
export class RoomSession {
  private uid = '';
  private stopWatching: (() => void) | null = null;
  private current: RoomView | null = null;
  private following = false;
  private creatingRematch = false;
  private ended = false;

  constructor(
    private readonly backend: RoomBackend,
    private readonly onView: (view: RoomView | null, closed: boolean) => void,
  ) {}

  get view(): RoomView | null {
    return this.current;
  }

  /** 開房。yourSeat 決定房主執黑或執白。 */
  async create(config: GameConfig, name: string, yourSeat: Seat): Promise<string> {
    this.uid = await this.backend.signIn();
    void this.backend.sweepStale().catch(() => undefined);
    let code = generateRoomCode();
    for (let tries = 0; tries < 5 && (await this.backend.read(code)); tries++) {
      code = generateRoomCode();
    }
    await this.backend.create(code, {
      createdAt: Date.now(),
      config,
      n: 0,
      players: { [yourSeat]: { uid: this.uid, name } },
    });
    await this.enter(code, yourSeat);
    return code;
  }

  /** 加入房間。已經在房內（重新整理）就恢復座位；房間已滿就變成觀戰。 */
  async join(code: string, name: string): Promise<JoinError | null> {
    this.uid = await this.backend.signIn();
    const room = await this.backend.read(code);
    if (!room) return 'not-found';

    let seat = (['black', 'white'] as const).find((s) => room.players[s]?.uid === this.uid) ?? null;
    if (!seat) {
      const open = (['black', 'white'] as const).find((s) => !room.players[s]);
      if (open) {
        try {
          await this.backend.update(code, { [`players/${open}`]: { uid: this.uid, name } });
          seat = open;
        } catch {
          // 同時有人搶先入座：規則會拒絕寫入，退回觀戰
          seat = null;
        }
      }
    }
    await this.enter(code, seat);
    return null;
  }

  private async enter(code: string, seat: Seat | null): Promise<void> {
    this.stopWatching?.();
    this.following = false;
    this.creatingRematch = false;
    if (seat) await this.backend.markPresent(code, seat).catch(() => undefined);
    this.stopWatching = this.backend.watch(code, (room) => this.receive(code, seat, room));
  }

  private receive(code: string, seat: Seat | null, room: RoomData | null): void {
    if (this.ended) return;
    if (!room) {
      this.current = null;
      this.onView(null, true);
      return;
    }
    const game = replayRoom(room);
    const opponent = seat ? otherSeat(seat) : null;
    this.current = {
      code,
      room,
      game,
      seat,
      opponentJoined: opponent ? Boolean(room.players[opponent]) : true,
      opponentOnline: opponent ? room.presence?.[opponent] !== false : true,
      myTurn:
        !!seat &&
        !game.result &&
        Boolean(room.players.black && room.players.white) &&
        seatOf(stoneAtPly(game.moves.length)) === seat,
    };
    this.onView(this.current, false);
    void this.handleRematch(room, seat);
  }

  async play(cell: number): Promise<void> {
    const view = this.current;
    if (!view?.myTurn || view.game.rejectionOf(cell)) return;
    const index = view.game.moves.length;
    await this.backend.update(view.code, {
      [`moves/${index}`]: { i: index, c: cell },
      n: index + 1,
    });
  }

  async resign(): Promise<void> {
    const view = this.current;
    if (!view?.seat || view.game.result) return;
    await this.backend.update(view.code, { [`resigned/${view.seat}`]: true });
  }

  async react(emoji: number): Promise<void> {
    const view = this.current;
    if (!view?.seat) return;
    await this.backend.update(view.code, {
      [`reaction/${view.seat}`]: { e: emoji, t: Date.now() },
    });
  }

  async requestRematch(): Promise<void> {
    const view = this.current;
    if (!view?.seat || !view.game.result) return;
    await this.backend.update(view.code, { [`rematch/${view.seat}`]: true });
  }

  /** 雙方都按再戰時，由黑方開新房（交換黑白），另一方跟著 next 過去。 */
  private async handleRematch(room: RoomData, seat: Seat | null): Promise<void> {
    if (room.next && !this.following) {
      this.following = true;
      const nextSeat = seat ? otherSeat(seat) : null;
      try {
        if (await this.backend.read(room.next)) await this.enter(room.next, nextSeat);
        else this.following = false;
      } catch {
        // 讀取失敗就等下一次房間更新再試
        this.following = false;
      }
      return;
    }
    const { black, white } = room.players;
    if (seat !== 'black' || !black || !white || room.next || this.creatingRematch) return;
    if (!room.rematch?.black || !room.rematch.white) return;
    this.creatingRematch = true;
    const code = generateRoomCode();
    await this.backend.create(code, {
      createdAt: Date.now(),
      config: room.config,
      n: 0,
      players: { black: white, white: black },
    });
    if (this.current) await this.backend.update(this.current.code, { next: code });
  }

  /** 離開房間。還沒開打的房間直接刪除，不留垃圾資料。 */
  async leave(): Promise<void> {
    const view = this.current;
    this.ended = true;
    this.stopWatching?.();
    this.stopWatching = null;
    this.current = null;
    if (!view?.seat) return;
    const { code, seat, room } = view;
    try {
      if (!room.players[otherSeat(seat)]) await this.backend.remove(code);
      else await this.backend.update(code, { [`presence/${seat}`]: false });
    } catch {
      // 離線時無法清理，留給 sweepStale
    }
  }
}
