import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { Game } from '../src/core/game.ts';
import { BLACK, WHITE } from '../src/core/types.ts';
import {
  clockAt,
  generateRoomCode,
  isFlagged,
  normaliseRoomCode,
  replayRoom,
  ROOM_CODE_PATTERN,
  RoomSession,
} from '../src/online/session.ts';
import type { RoomView } from '../src/online/session.ts';
import type { RoomData } from '../src/online/types.ts';
import { PermissionDenied, RulesBackend, RulesDb } from './helpers/rules-db.ts';

const CONFIG = { size: 15, rule: 'freestyle' } as const;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

interface Client {
  session: RoomSession;
  backend: RulesBackend;
  view: () => RoomView | null;
}

function client(db: RulesDb, uid: string): Client {
  const backend = new RulesBackend(db, uid);
  let latest: RoomView | null = null;
  const session = new RoomSession(backend, (view) => {
    latest = view;
  });
  return { session, backend, view: () => latest };
}

async function startedRoom(db: RulesDb) {
  const alice = client(db, 'alice');
  const bob = client(db, 'bob');
  const code = await alice.session.create(CONFIG, '小明', 'black');
  await bob.session.join(code, '小華');
  await tick();
  return { alice, bob, code };
}

describe('線上棋鐘', () => {
  const TIMED = { ...CONFIG, clockMs: 60_000 };

  async function timedRoom() {
    const db = new RulesDb();
    const alice = client(db, 'alice');
    const bob = client(db, 'bob');
    const code = await alice.session.create(TIMED, '小明', 'black');
    await bob.session.join(code, '小華');
    await tick();
    return { db, alice, bob, code };
  }

  it('第一手不計時，之後依伺服器時間戳扣時', async () => {
    const { db, alice, bob } = await timedRoom();
    db.offset += 30_000;
    await alice.session.play(112);
    await tick();
    db.offset += 20_000;
    await bob.session.play(113);
    await tick();
    const left = alice.view()?.clock?.left;
    assert.equal(left?.[BLACK], 60_000);
    assert.ok(Math.abs((left?.[WHITE] ?? 0) - 40_000) < 200, String(left?.[WHITE]));
  });

  it('超時後的棋步不算，判超時負', async () => {
    const { db, alice, bob, code } = await timedRoom();
    await alice.session.play(112);
    await tick();
    db.offset += 61_000;
    const view = bob.view() as RoomView;
    assert.equal(isFlagged(view, bob.session.serverNow()), true);
    assert.equal(clockAt(view, bob.session.serverNow())?.[WHITE], 0);
    await new RulesBackend(db, 'bob').update(code, {
      'moves/1': { i: 1, c: 113, t: { '.sv': 'timestamp' } },
      n: 2,
    });
    await tick();
    const game = replayRoom(db.read(`rooms/${code}`) as RoomData);
    assert.equal(game.moves.length, 1);
    assert.equal(game.result?.reason, 'timeout');
    assert.equal(game.result?.winner, BLACK);
  });

  it('限時對局的棋步一定要帶伺服器時間，不限時的不帶也可以', async () => {
    const { db, code } = await timedRoom();
    const backend = new RulesBackend(db, 'alice');
    await assert.rejects(
      backend.update(code, { 'moves/0': { i: 0, c: 112 }, n: 1 }),
      PermissionDenied,
    );
    await assert.rejects(
      backend.update(code, { 'moves/0': { i: 0, c: 112, t: 1 }, n: 1 }),
      PermissionDenied,
    );
    const free = new RulesDb();
    const { alice } = await startedRoom(free);
    await alice.session.play(112);
    await tick();
    assert.equal(alice.view()?.game.moves.length, 1);
  });
});

describe('房間代碼', () => {
  it('產生的代碼永遠合法且沒有易混淆字元', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode();
      assert.ok(ROOM_CODE_PATTERN.test(code), code);
      assert.ok(!/[01IO]/.test(code));
    }
  });
  it('接受小寫與邀請連結', () => {
    assert.equal(normaliseRoomCode(' abc234 '), 'ABC234');
    assert.equal(normaliseRoomCode('https://x.io/#/r/ABC234'), 'ABC234');
    assert.equal(normaliseRoomCode('ABC'), null);
  });
});

describe('線上對局流程（每次寫入都經過 database.rules.json）', () => {
  let db: RulesDb;
  beforeEach(() => {
    db = new RulesDb();
  });

  it('開房、加入、輪流落子、五連獲勝', async () => {
    const { alice, bob } = await startedRoom(db);
    assert.equal(alice.view()?.seat, 'black');
    assert.equal(bob.view()?.seat, 'white');
    assert.equal(alice.view()?.myTurn, true);
    assert.equal(bob.view()?.myTurn, false);

    for (let col = 0; col < 4; col++) {
      await alice.session.play(7 * 15 + col);
      await bob.session.play(8 * 15 + col);
    }
    await alice.session.play(7 * 15 + 4);
    await tick();
    assert.equal(alice.view()?.game.result?.winner, BLACK);
    assert.equal(bob.view()?.game.result?.winner, BLACK);
    assert.deepEqual(db.denied, []);
  });

  it('不是自己的回合時，session 不送出', async () => {
    const { bob, code } = await startedRoom(db);
    await bob.session.play(0);
    assert.equal((await bob.backend.read(code))?.n, 0);
  });

  it('重新整理後恢復座位與棋局', async () => {
    const { alice, code } = await startedRoom(db);
    await alice.session.play(112);
    await tick();
    const reloaded = client(db, 'alice');
    await reloaded.session.join(code, '小明');
    await tick();
    assert.equal(reloaded.view()?.seat, 'black');
    assert.deepEqual(reloaded.view()?.game.moves, [112]);
  });

  it('第三人加入變成觀戰，不能下棋', async () => {
    const { code } = await startedRoom(db);
    const carol = client(db, 'carol');
    await carol.session.join(code, '路人');
    await tick();
    assert.equal(carol.view()?.seat, null);
    assert.equal(carol.view()?.myTurn, false);
    await carol.session.play(0);
    assert.equal((await carol.backend.read(code))?.n, 0);
  });

  it('認輸', async () => {
    const { alice, bob } = await startedRoom(db);
    await bob.session.resign();
    await tick();
    assert.equal(alice.view()?.game.result?.winner, BLACK);
    assert.equal(alice.view()?.game.result?.reason, 'resign');
  });

  it('再戰：開新房並交換黑白', async () => {
    const { alice, bob, code } = await startedRoom(db);
    await bob.session.resign();
    await tick();
    await alice.session.requestRematch();
    await bob.session.requestRematch();
    await tick();
    await tick();
    assert.notEqual(alice.view()?.code, code);
    assert.equal(alice.view()?.code, bob.view()?.code);
    assert.equal(alice.view()?.seat, 'white');
    assert.equal(bob.view()?.seat, 'black');
    assert.equal(bob.view()?.myTurn, true);
    assert.deepEqual(db.denied, []);
  });

  it('對手離開會顯示離線；還沒人加入的房間會被刪除', async () => {
    const { alice, bob } = await startedRoom(db);
    await bob.session.leave();
    await tick();
    assert.equal(alice.view()?.opponentOnline, false);

    const solo = client(db, 'dana');
    const code = await solo.session.create(CONFIG, 'D', 'black');
    await solo.session.leave();
    assert.equal(db.read(`rooms/${code}`), null);
  });

  it('找不到房間時回報錯誤', async () => {
    const dana = client(db, 'dana');
    assert.equal(await dana.session.join('ZZZZZZ', 'D'), 'not-found');
  });
});

describe('安全規則擋下的作弊', () => {
  let db: RulesDb;
  let code: string;
  const write = (uid: string | null, patch: Record<string, unknown>) =>
    db.write(
      Object.fromEntries(Object.entries(patch).map(([k, v]) => [`rooms/${code}/${k}`, v])),
      uid ? { uid } : null,
    );

  beforeEach(async () => {
    db = new RulesDb();
    code = (await startedRoom(db)).code;
  });

  const denied = (fn: () => void) => assert.throws(fn, PermissionDenied);

  it('未登入不能寫', () => {
    denied(() => write(null, { 'moves/0': { i: 0, c: 1 }, n: 1 }));
  });

  it('不能替對手下棋或搶手', () => {
    denied(() => write('bob', { 'moves/0': { i: 0, c: 1 }, n: 1 }));
    denied(() => write('mallory', { 'moves/0': { i: 0, c: 1 }, n: 1 }));
  });

  it('棋步與手數必須一起更新且依序', () => {
    denied(() => write('alice', { 'moves/0': { i: 0, c: 1 } }));
    denied(() => write('alice', { 'moves/0': { i: 5, c: 1 }, n: 1 }));
    denied(() => write('alice', { 'moves/0': { i: 0, c: 1 }, n: 2 }));
  });

  it('不能覆蓋已下的棋或下到棋盤外', () => {
    write('alice', { 'moves/0': { i: 0, c: 1 }, n: 1 });
    denied(() => write('alice', { 'moves/0': { i: 1, c: 2 }, n: 2 }));
    denied(() => write('bob', { 'moves/1': { i: 1, c: 225 }, n: 2 }));
    denied(() => write('bob', { 'moves/1': { i: 1, c: -1 }, n: 2 }));
  });

  it('不能替別人認輸', () => {
    denied(() => write('alice', { 'resigned/white': true }));
    denied(() => write('mallory', { 'resigned/black': true }));
  });

  it('認輸後不能再落子', () => {
    write('bob', { 'resigned/white': true });
    denied(() => write('alice', { 'moves/0': { i: 0, c: 1 }, n: 1 }));
  });

  it('不能搶座位、改設定或塞入多餘欄位', () => {
    denied(() => write('mallory', { 'players/white': { uid: 'mallory', name: 'x' } }));
    denied(() => write('alice', { 'config/size': 19 }));
    denied(() => write('alice', { winner: 'black' }));
    denied(() => write('alice', { n: 0 }));
  });

  it('外人不能刪房，也不能覆寫整間房', () => {
    denied(() => db.write({ [`rooms/${code}`]: null }, { uid: 'mallory' }));
    denied(() =>
      db.write(
        { [`rooms/${code}`]: { createdAt: 1, config: CONFIG, n: 0, players: {} } },
        { uid: 'alice' },
      ),
    );
  });

  it('雙方都入座後，棋手也不能刪房', () => {
    denied(() => db.write({ [`rooms/${code}`]: null }, { uid: 'alice' }));
    denied(() => db.write({ [`rooms/${code}`]: null }, { uid: 'bob' }));
  });

  it('超過一天的房間任何登入者都能清除', () => {
    const tree = db.tree as { rooms: Record<string, RoomData> };
    (tree.rooms[code] as RoomData).createdAt = Date.now() - 25 * 60 * 60 * 1000;
    db.write({ [`rooms/${code}`]: null }, { uid: 'mallory' });
    assert.equal(db.read(`rooms/${code}`), null);
  });

  it('名字長度與座位名稱受限', () => {
    const fresh = 'ABCDEF';
    denied(() =>
      db.write(
        {
          [`rooms/${fresh}`]: {
            createdAt: 1,
            config: CONFIG,
            n: 0,
            players: { black: { uid: 'x', name: 'n'.repeat(17) } },
          },
        },
        { uid: 'x' },
      ),
    );
    denied(() =>
      db.write(
        {
          [`rooms/lower1`]: {
            createdAt: 1,
            config: CONFIG,
            n: 0,
            players: { black: { uid: 'x', name: 'ok' } },
          },
        },
        { uid: 'x' },
      ),
    );
  });
});

describe('重演棋局', () => {
  const room = (moves: number[], extra: Partial<RoomData> = {}): RoomData => ({
    createdAt: 1,
    config: CONFIG,
    n: moves.length,
    players: {},
    moves: Object.fromEntries(moves.map((c, i) => [i, { i, c }])),
    ...extra,
  });

  it('Firebase 回傳陣列或物件都能處理，順序以 i 為準', () => {
    const asArray = replayRoom({
      ...room([]),
      moves: [
        { i: 0, c: 1 },
        { i: 1, c: 2 },
      ],
    });
    const shuffled = replayRoom({
      ...room([]),
      moves: { b: { i: 1, c: 2 }, a: { i: 0, c: 1 } },
    });
    assert.deepEqual(asArray.moves, [1, 2]);
    assert.deepEqual(shuffled.moves, [1, 2]);
  });

  it('重複落子的一方判負', () => {
    const game = replayRoom(room([10, 10]));
    assert.equal(game.result?.winner, BLACK);
  });

  it('只加手數不落子的一方判負', () => {
    const game = replayRoom({ ...room([]), n: 1 });
    assert.equal(game.result?.winner, WHITE);
    const skipped = replayRoom({ ...room([]), n: 2, moves: { x: { i: 1, c: 5 } } });
    assert.equal(skipped.result?.winner, WHITE);
  });

  it('終局後多寫的棋步被忽略', () => {
    const win = [0, 15, 1, 16, 2, 17, 3, 18, 4];
    const game = replayRoom(room([...win, 200, 201]));
    assert.deepEqual(game.moves, win);
    assert.equal(game.result?.winner, BLACK);
  });

  it('連珠禁手在重演時同樣有效', () => {
    const config = { size: 15, rule: 'renju' } as const;
    const base = Game.fromMoves(config, []);
    assert.equal(base.turn, BLACK);
    // 黑 (6,6) (7,6) (8,7) (8,8) 之後下 (8,6) 是雙三
    const moves = [96, 0, 111, 14, 127, 210, 128, 224, 126];
    const game = replayRoom({ ...room(moves), config });
    assert.equal(game.result?.winner, WHITE, '黑下禁手判負');
  });
});
