import fs from 'node:fs';
import type { RoomBackend, RoomData, Seat } from '../../src/online/types.ts';

/**
 * 記憶體版 Realtime Database：真的載入 database.rules.json 逐條執行。
 * 用來驗證「客戶端每一次寫入都過得了規則」以及「作弊的寫入都被擋下」。
 * 它模擬規則的求值語意（.write 向下繼承、.validate 不可繞過、多路徑原子更新），
 * 但不是 Firebase 官方引擎，上線前仍建議跑 Firebase Emulator。
 */

type Json = unknown;
type Tree = Record<string, Json>;
type Rules = { [key: string]: Rules | string | boolean | string[] };

declare global {
  interface String {
    matches(pattern: RegExp): boolean;
  }
}
String.prototype.matches = function matches(pattern: RegExp) {
  return pattern.test(String(this));
};

const clean = (value: Json): Json => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  const out: Tree = {};
  for (const [key, child] of Object.entries(value as Tree)) {
    const cleaned = clean(child);
    if (cleaned !== null) out[key] = cleaned;
  }
  return Object.keys(out).length ? out : null;
};

const getPath = (tree: Json, path: string[]): Json => {
  let node = tree;
  for (const key of path) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Tree)[key] ?? null;
  }
  return node;
};

const setPath = (tree: Json, path: string[], value: Json): Json => {
  if (path.length === 0) return clean(value);
  const [head, ...rest] = path as [string, ...string[]];
  const copy: Tree =
    tree !== null && typeof tree === 'object' ? { ...(tree as Tree) } : ({} as Tree);
  copy[head] = setPath(copy[head] ?? null, rest, value);
  return clean(copy);
};

class Snapshot {
  constructor(
    private readonly tree: Json,
    private readonly path: string[],
  ) {}
  private get value(): Json {
    return getPath(this.tree, this.path);
  }
  val(): Json {
    return this.value;
  }
  exists(): boolean {
    return this.value !== null;
  }
  child(path: string): Snapshot {
    return new Snapshot(this.tree, [...this.path, ...path.split('/').filter(Boolean)]);
  }
  parent(): Snapshot {
    if (this.path.length === 0) throw new Error('root has no parent');
    return new Snapshot(this.tree, this.path.slice(0, -1));
  }
  hasChildren(keys: string[]): boolean {
    const value = this.value;
    return (
      value !== null &&
      typeof value === 'object' &&
      keys.every((key) => (value as Tree)[key] !== undefined)
    );
  }
  isNumber(): boolean {
    return typeof this.value === 'number';
  }
  isString(): boolean {
    return typeof this.value === 'string';
  }
  isBoolean(): boolean {
    return typeof this.value === 'boolean';
  }
}

interface Scope {
  auth: { uid: string } | null;
  now: number;
  data: Json;
  newData: Json;
  path: string[];
  vars: Record<string, string>;
}

function evaluate(rule: string | boolean, scope: Scope): boolean {
  if (typeof rule === 'boolean') return rule;
  const names = Object.keys(scope.vars);
  const fn = new Function(
    'auth',
    'now',
    'data',
    'newData',
    'root',
    ...names,
    `return (${rule});`,
  ) as (...args: unknown[]) => unknown;
  try {
    return (
      fn(
        scope.auth,
        scope.now,
        new Snapshot(scope.data, scope.path),
        new Snapshot(scope.newData, scope.path),
        new Snapshot(scope.data, []),
        ...names.map((name) => scope.vars[name]),
      ) === true
    );
  } catch {
    return false;
  }
}

function descend(rules: Rules | null, key: string, vars: Record<string, string>): Rules | null {
  if (!rules) return null;
  if (key in rules && !key.startsWith('.')) return rules[key] as Rules;
  const wildcard = Object.keys(rules).find((name) => name.startsWith('$'));
  if (!wildcard) return null;
  vars[wildcard] = key;
  return rules[wildcard] as Rules;
}

export class PermissionDenied extends Error {}

export class RulesDb {
  tree: Json = null;
  private readonly rules = (
    JSON.parse(fs.readFileSync('database.rules.json', 'utf8')) as { rules: Rules }
  ).rules;
  private readonly listeners = new Map<string, Set<() => void>>();
  /** 每筆被拒絕的寫入，方便測試斷言 */
  denied: string[] = [];

  private canWrite(path: string[], newTree: Json, auth: Scope['auth']): boolean {
    const vars: Record<string, string> = {};
    let rules: Rules | null = this.rules;
    const scope = (at: string[]): Scope => ({
      auth,
      now: Date.now(),
      data: this.tree,
      newData: newTree,
      path: at,
      vars,
    });
    const hasRule = rules['.write'];
    if (hasRule !== undefined && evaluate(hasRule as string, scope([]))) return true;
    for (let i = 0; i < path.length; i++) {
      rules = descend(rules, path[i] as string, vars);
      if (!rules) return false;
      const rule = rules['.write'];
      if (rule !== undefined && evaluate(rule as string | boolean, scope(path.slice(0, i + 1)))) {
        return true;
      }
    }
    return false;
  }

  /** 檢查路徑上的祖先節點，以及新值底下所有節點的 .validate */
  private validates(path: string[], newTree: Json, auth: Scope['auth']): boolean {
    const walk = (rules: Rules | null, at: string[], vars: Record<string, string>): boolean => {
      if (!rules) return true;
      const value = getPath(newTree, at);
      if (value === null) return true;
      const rule = rules['.validate'];
      const scope: Scope = {
        auth,
        now: Date.now(),
        data: this.tree,
        newData: newTree,
        path: at,
        vars,
      };
      if (rule !== undefined && !evaluate(rule as string | boolean, scope)) return false;
      if (at.length < path.length) {
        const next = { ...vars };
        return walk(
          descend(rules, path[at.length] as string, next),
          path.slice(0, at.length + 1),
          next,
        );
      }
      if (value === null || typeof value !== 'object') return true;
      return Object.keys(value as Tree).every((key) => {
        const next = { ...vars };
        return walk(descend(rules, key, next), [...at, key], next);
      });
    };
    return walk(this.rules, [], {});
  }

  /** 多路徑寫入：全部通過才一起生效。 */
  write(patch: Record<string, Json>, auth: Scope['auth']): void {
    let next = this.tree;
    const paths = Object.keys(patch).map((key) => key.split('/').filter(Boolean));
    for (const [key, value] of Object.entries(patch)) {
      next = setPath(next, key.split('/').filter(Boolean), value);
    }
    for (const path of paths) {
      if (!this.canWrite(path, next, auth) || !this.validates(path, next, auth)) {
        this.denied.push(path.join('/'));
        throw new PermissionDenied(`PERMISSION_DENIED: ${path.join('/')}`);
      }
    }
    this.tree = next;
    for (const set of this.listeners.values()) for (const fn of set) fn();
  }

  read(path: string): Json {
    return getPath(this.tree, path.split('/').filter(Boolean));
  }

  listen(path: string, fn: () => void): () => void {
    const set = this.listeners.get(path) ?? new Set();
    set.add(fn);
    this.listeners.set(path, set);
    return () => set.delete(fn);
  }
}

/** 綁定某位使用者的 RoomBackend，所有寫入都會經過規則。 */
export class RulesBackend implements RoomBackend {
  constructor(
    private readonly db: RulesDb,
    private readonly uid: string,
  ) {}
  private get auth() {
    return { uid: this.uid };
  }
  async signIn() {
    return this.uid;
  }
  async read(code: string) {
    return this.db.read(`rooms/${code}`) as RoomData | null;
  }
  async create(code: string, room: RoomData) {
    this.db.write({ [`rooms/${code}`]: room }, this.auth);
  }
  async update(code: string, patch: Record<string, unknown>) {
    const full = Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [`rooms/${code}/${key}`, value]),
    );
    this.db.write(full, this.auth);
  }
  watch(code: string, listener: (room: RoomData | null) => void) {
    const emit = () => listener(this.db.read(`rooms/${code}`) as RoomData | null);
    const stop = this.db.listen(`${this.uid}:${code}`, emit);
    queueMicrotask(emit);
    return stop;
  }
  async markPresent(code: string, seat: Seat) {
    await this.update(code, { [`presence/${seat}`]: true });
  }
  async remove(code: string) {
    this.db.write({ [`rooms/${code}`]: null }, this.auth);
  }
  async sweepStale() {}
}
