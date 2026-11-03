import { AiClient, CancelledError } from '../ai/client.ts';
import type { MoveReview } from '../ai/analysis.ts';
import { ANALYSIS_LIMITS, LEVEL_LIMITS } from '../ai/levels.ts';
import type { AiLevel } from '../ai/levels.ts';
import { Game } from '../core/game.ts';
import type { GameConfig } from '../core/game.ts';
import { PUZZLES } from '../core/puzzle-data.ts';
import type { MoveRejection, Stone } from '../core/types.ts';
import { BLACK, WHITE } from '../core/types.ts';
import { RoomSession } from '../online/session.ts';
import type { RoomView } from '../online/session.ts';
import { roomBackend } from '../online/index.ts';
import type { Seat } from '../online/types.ts';
import { stoneOf } from '../online/types.ts';
import { playLose, playNudge, playStone, playWin } from '../platform/sound.ts';
import { erase, load, save } from '../platform/storage.ts';
import { addGameLog, markPuzzleSolved } from './records.ts';
import { settings } from './settings.ts';
import { signal } from './signal.ts';

export const ai = new AiClient();

const stoneSound = (): void => {
  if (settings.peek().sound) playStone();
};
const endSound = (won: boolean | null): void => {
  if (!settings.peek().sound) return;
  if (won === false) playLose();
  else playWin();
};

export type Names = Record<Stone, string | null>;

/** 所有對局模式的共同介面，棋盤與面板只依賴這一層。 */
export abstract class Match {
  abstract readonly kind: 'ai' | 'local' | 'puzzle' | 'online' | 'review';
  /** 棋局內容改變時遞增 */
  readonly revision = signal(0);
  readonly thinking = signal(false);
  readonly hint = signal<number | null>(null);
  /** 被拒絕的落子原因，顯示給玩家 */
  readonly notice = signal<MoveRejection | null>(null);

  abstract get game(): Game;
  abstract get human(): Stone | null;
  abstract acceptsInput(): boolean;
  abstract play(cell: number): void;
  dispose(): void {}

  protected changed(): void {
    this.revision.value++;
  }
}

export interface PlayOptions {
  kind: 'ai' | 'local';
  config: GameConfig;
  level?: AiLevel;
  human?: Stone;
  clockMs?: number;
  moves?: readonly number[];
}

interface SavedGame {
  kind: 'ai' | 'local';
  config: GameConfig;
  level?: AiLevel;
  human?: Stone;
  moves: number[];
}

export function loadSavedGame(): SavedGame | null {
  const saved = load<SavedGame | null>('current', null);
  if (!saved) return null;
  try {
    Game.fromMoves(saved.config, saved.moves);
    return saved;
  } catch {
    erase('current');
    return null;
  }
}

/** 與電腦對弈或兩人同機。 */
export class PlayMatch extends Match {
  readonly kind: 'ai' | 'local';
  readonly game: Game;
  readonly level: AiLevel | undefined;
  readonly clocks = signal<Record<Stone, number> | null>(null);
  private readonly humanStone: Stone | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private searchToken = 0;
  private logged = false;

  constructor(private readonly options: PlayOptions) {
    super();
    this.kind = options.kind;
    this.level = options.level;
    this.humanStone = options.kind === 'ai' ? (options.human ?? BLACK) : null;
    this.game = Game.fromMoves(options.config, options.moves ?? []);
    if (options.clockMs) {
      this.clocks.value = { [BLACK]: options.clockMs, [WHITE]: options.clockMs };
      this.lastTick = Date.now();
      this.timer = setInterval(() => this.tick(), 250);
    }
    this.maybeAskComputer();
  }

  get human(): Stone | null {
    return this.humanStone;
  }

  get againOptions(): PlayOptions {
    const { moves: _moves, ...rest } = this.options;
    return rest;
  }

  acceptsInput(): boolean {
    if (this.game.result || this.thinking.peek()) return false;
    return this.kind === 'local' || this.game.turn === this.humanStone;
  }

  play(cell: number): void {
    if (!this.acceptsInput()) return;
    this.place(cell);
    this.maybeAskComputer();
  }

  private place(cell: number): void {
    const rejection = this.game.play(cell);
    this.notice.value = rejection;
    if (rejection) {
      if (settings.peek().sound) playNudge();
      return;
    }
    this.hint.value = null;
    stoneSound();
    this.persist();
    this.changed();
    if (this.game.result) this.finish();
  }

  private maybeAskComputer(): void {
    if (this.kind !== 'ai' || this.game.result || this.game.turn === this.humanStone) return;
    const level = this.level ?? 'medium';
    const token = ++this.searchToken;
    this.thinking.value = true;
    const started = Date.now();
    void ai
      .search(this.game.config, this.game.moves, LEVEL_LIMITS[level])
      .then(async (outcome) => {
        // 讓電腦的落子有一點節奏，不會在玩家手還沒離開時就出現
        const wait = 260 - (Date.now() - started);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        if (token !== this.searchToken) return;
        this.thinking.value = false;
        this.place(outcome.move);
      })
      .catch((error: unknown) => {
        if (token === this.searchToken) this.thinking.value = false;
        if (!(error instanceof CancelledError)) console.error(error);
      });
  }

  private tick(): void {
    const clocks = this.clocks.peek();
    const now = Date.now();
    const elapsed = now - this.lastTick;
    this.lastTick = now;
    if (!clocks || this.game.result || this.game.moves.length === 0) return;
    const side = this.game.turn;
    const left = Math.max(0, clocks[side] - elapsed);
    this.clocks.value = { ...clocks, [side]: left };
    if (left === 0) {
      this.stopSearch();
      this.game.conclude(side, 'timeout');
      this.changed();
      this.finish();
    }
  }

  private stopSearch(): void {
    this.searchToken++;
    if (this.thinking.peek()) ai.cancel();
    this.thinking.value = false;
  }

  canUndo(): boolean {
    if (this.game.result) return false;
    if (this.kind === 'local') return this.game.moves.length > 0;
    // 對電腦時要退回自己上一手，所以至少要有自己下過的棋
    return this.game.moves.length >= (this.humanStone === BLACK ? 1 : 2);
  }

  undo(): void {
    if (!this.canUndo()) return;
    this.stopSearch();
    this.game.undo();
    if (this.kind === 'ai') {
      while (this.game.moves.length > 0 && this.game.turn !== this.humanStone) this.game.undo();
    }
    this.hint.value = null;
    this.notice.value = null;
    this.persist();
    this.changed();
    this.maybeAskComputer();
  }

  showHint(): void {
    if (this.game.result || this.hint.peek() !== null || !this.acceptsInput()) return;
    const moves = this.game.moves.length;
    void ai
      .search(this.game.config, this.game.moves, ANALYSIS_LIMITS)
      .then((outcome) => {
        if (moves === this.game.moves.length) this.hint.value = outcome.move;
      })
      .catch(() => undefined);
  }

  resign(): void {
    if (this.game.result) return;
    this.stopSearch();
    this.game.conclude(this.humanStone ?? this.game.turn, 'resign');
    this.changed();
    this.finish();
  }

  private persist(): void {
    if (this.options.clockMs || this.game.result || this.game.moves.length === 0) {
      erase('current');
      return;
    }
    const { kind, config, level, human } = this.options;
    const saved: SavedGame = {
      kind,
      config,
      moves: [...this.game.moves],
      ...(level ? { level } : {}),
      ...(human ? { human } : {}),
    };
    save('current', saved);
  }

  private finish(): void {
    this.stopTimer();
    erase('current');
    const result = this.game.result;
    if (!result || this.logged) return;
    this.logged = true;
    endSound(this.humanStone && result.winner ? result.winner === this.humanStone : null);
    addGameLog({
      id: crypto.randomUUID(),
      playedAt: Date.now(),
      kind: this.kind,
      ...this.game.config,
      moves: [...this.game.moves],
      winner: result.winner,
      reason: result.reason,
      human: this.humanStone,
      ...(this.level ? { level: this.level } : {}),
    });
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  override dispose(): void {
    this.stopSearch();
    this.stopTimer();
  }
}

/** 殘局題：玩家要在限定手數內取勝，對手由 AI 應對。 */
export class PuzzleMatch extends Match {
  readonly kind = 'puzzle';
  readonly game: Game;
  readonly solver: Stone;
  readonly left = signal(0);
  private token = 0;

  constructor(readonly index: number) {
    super();
    const puzzle = PUZZLES[index];
    if (!puzzle) throw new Error(`沒有第 ${index} 題`);
    this.game = Game.fromMoves({ size: 15, rule: 'freestyle' }, puzzle.moves);
    this.solver = this.game.turn;
    this.left.value = puzzle.winIn;
  }

  get human(): Stone {
    return this.solver;
  }

  get solved(): boolean {
    return this.game.result?.winner === this.solver;
  }

  get failed(): boolean {
    if (this.thinking.peek()) return false;
    return (this.game.result !== null && !this.solved) || (this.left.peek() === 0 && !this.solved);
  }

  acceptsInput(): boolean {
    return (
      !this.game.result &&
      !this.thinking.peek() &&
      this.left.peek() > 0 &&
      this.game.turn === this.solver
    );
  }

  play(cell: number): void {
    if (!this.acceptsInput()) return;
    const rejection = this.game.play(cell);
    this.notice.value = rejection;
    if (rejection) return;
    this.hint.value = null;
    stoneSound();
    this.left.value--;
    if (this.solved) {
      markPuzzleSolved(this.index);
      endSound(true);
    } else if (this.left.peek() === 0) {
      endSound(false);
    } else {
      this.reply();
    }
    this.changed();
  }

  private reply(): void {
    const token = ++this.token;
    this.thinking.value = true;
    void ai
      .search(this.game.config, this.game.moves, { ...ANALYSIS_LIMITS, timeMs: 160 })
      .then(async (outcome) => {
        await new Promise((resolve) => setTimeout(resolve, 240));
        if (token !== this.token) return;
        this.thinking.value = false;
        this.game.play(outcome.move);
        stoneSound();
        if (this.game.result) endSound(false);
        this.changed();
      })
      .catch(() => {
        if (token === this.token) this.thinking.value = false;
      });
  }

  showHint(): void {
    if (!this.acceptsInput() || this.hint.peek() !== null) return;
    void ai
      .search(this.game.config, this.game.moves, ANALYSIS_LIMITS)
      .then((outcome) => {
        this.hint.value = outcome.move;
      })
      .catch(() => undefined);
  }

  override dispose(): void {
    this.token++;
    if (this.thinking.peek()) ai.cancel();
  }
}

/** 線上對局：所有狀態都來自 RoomSession，這裡只負責轉接。 */
export class OnlineMatch extends Match {
  readonly kind = 'online';
  readonly view = signal<RoomView | null>(null);
  readonly closed = signal(false);
  readonly lastReaction = signal<{ seat: Seat; emoji: number; at: number } | null>(null);
  private session: RoomSession | null = null;
  private fallback = new Game();
  private movesSeen = 0;
  private loggedRoom = '';
  private seenReactionAt = Date.now();

  private async connect(): Promise<RoomSession> {
    const backend = await roomBackend();
    this.session = new RoomSession(backend, (view, closed) => this.receive(view, closed));
    return this.session;
  }

  async create(config: GameConfig, name: string, seat: Seat): Promise<string> {
    const session = await this.connect();
    return session.create(config, name, seat);
  }

  async join(code: string, name: string) {
    const session = await this.connect();
    return session.join(code, name);
  }

  private receive(view: RoomView | null, closed: boolean): void {
    const previous = this.movesSeen;
    this.view.value = view;
    if (closed) this.closed.value = true;
    if (!view) return;
    this.movesSeen = view.game.moves.length;
    if (view.game.moves.length > previous && previous > 0) stoneSound();
    else if (view.game.moves.length === 1 && previous === 0) stoneSound();
    this.watchReactions(view);
    this.changed();
    const result = view.game.result;
    if (result && this.loggedRoom !== view.code) {
      this.loggedRoom = view.code;
      if (view.seat) this.logResult(view);
    }
  }

  private watchReactions(view: RoomView): void {
    for (const seat of ['black', 'white'] as const) {
      const reaction = view.room.reaction?.[seat];
      if (reaction && reaction.t > this.seenReactionAt) {
        this.seenReactionAt = reaction.t;
        this.lastReaction.value = { seat, emoji: reaction.e, at: reaction.t };
      }
    }
  }

  private logResult(view: RoomView): void {
    const result = view.game.result;
    if (!result || !view.seat) return;
    const mine = stoneOf(view.seat);
    endSound(result.winner ? result.winner === mine : null);
    const other = view.room.players[view.seat === 'black' ? 'white' : 'black'];
    addGameLog({
      id: `${view.code}-${view.game.moves.length}`,
      playedAt: Date.now(),
      kind: 'online',
      ...view.game.config,
      moves: [...view.game.moves],
      winner: result.winner,
      reason: result.reason,
      human: mine,
      ...(other ? { opponent: other.name } : {}),
    });
  }

  get game(): Game {
    return this.view.peek()?.game ?? this.fallback;
  }

  get human(): Stone | null {
    const seat = this.view.peek()?.seat;
    return seat ? stoneOf(seat) : null;
  }

  acceptsInput(): boolean {
    return this.view.peek()?.myTurn ?? false;
  }

  play(cell: number): void {
    const game = this.game;
    const rejection = game.rejectionOf(cell);
    this.notice.value = rejection;
    if (rejection || !this.acceptsInput()) return;
    void this.session?.play(cell);
  }

  resign(): void {
    void this.session?.resign();
  }

  rematch(): void {
    void this.session?.requestRematch();
  }

  react(emoji: number): void {
    void this.session?.react(emoji);
  }

  override dispose(): void {
    void this.session?.leave();
  }
}

/** 復盤：在一盤已知棋譜上前後移動，並可請 AI 分析。 */
export class ReviewMatch extends Match {
  readonly kind = 'review';
  readonly cursor = signal(0);
  readonly reviews = signal<MoveReview[] | null>(null);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly playing = signal(false);
  private shown: Game;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly config: GameConfig,
    readonly moves: readonly number[],
    readonly human: Stone | null = null,
    readonly finalResult: Game['result'] = null,
    cursor = moves.length,
  ) {
    super();
    this.shown = Game.fromMoves(config, moves.slice(0, cursor));
    this.cursor.value = cursor;
  }

  get game(): Game {
    return this.shown;
  }

  acceptsInput(): boolean {
    return false;
  }

  play(): void {}

  seek(ply: number): void {
    const target = Math.max(0, Math.min(this.moves.length, ply));
    if (target === this.cursor.peek()) return;
    this.shown = Game.fromMoves(this.config, this.moves.slice(0, target));
    this.cursor.value = target;
    this.changed();
  }

  togglePlaying(): void {
    if (this.timer) {
      this.stopPlaying();
      return;
    }
    if (this.cursor.peek() >= this.moves.length) this.seek(0);
    this.playing.value = true;
    this.timer = setInterval(() => {
      if (this.cursor.peek() >= this.moves.length) this.stopPlaying();
      else {
        this.seek(this.cursor.peek() + 1);
        stoneSound();
      }
    }, 650);
  }

  private stopPlaying(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.playing.value = false;
  }

  analyse(): void {
    if (this.progress.peek() || this.reviews.peek()) return;
    this.progress.value = { done: 0, total: this.moves.length };
    void ai
      .review(this.config, this.moves, (done, total) => {
        this.progress.value = { done, total };
      })
      .then((reviews) => {
        this.reviews.value = reviews;
        this.progress.value = null;
      })
      .catch(() => {
        this.progress.value = null;
      });
  }

  /** 目前這手（即將下的那手）AI 建議的位置 */
  suggestionAt(ply: number): number | null {
    return this.reviews.peek()?.[ply]?.suggestion ?? null;
  }

  override dispose(): void {
    this.stopPlaying();
    if (this.progress.peek()) ai.cancel();
  }
}
