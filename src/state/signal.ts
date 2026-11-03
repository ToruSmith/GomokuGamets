/**
 * 約 100 行的響應式核心：signal 存值、effect 自動追蹤依賴。
 * effect 內建立的 effect 會在外層重跑時一併釋放，所以畫面區塊可以放心重建。
 */

type Cleanup = () => void;

interface Computation {
  run(): void;
  sources: Set<Set<Computation>>;
  children: Set<Computation>;
  cleanups: Cleanup[];
  disposed: boolean;
}

let active: Computation | null = null;
let batching = 0;
const queued = new Set<Computation>();

function flush(): void {
  while (queued.size > 0) {
    const pending = [...queued];
    queued.clear();
    for (const computation of pending) if (!computation.disposed) computation.run();
  }
}

export class Signal<T> {
  private current: T;
  private readonly subscribers = new Set<Computation>();

  constructor(initial: T) {
    this.current = initial;
  }

  get value(): T {
    if (active) {
      this.subscribers.add(active);
      active.sources.add(this.subscribers);
    }
    return this.current;
  }

  set value(next: T) {
    if (Object.is(this.current, next)) return;
    this.current = next;
    for (const subscriber of this.subscribers) queued.add(subscriber);
    if (batching === 0) flush();
  }

  /** 讀取但不建立依賴 */
  peek(): T {
    return this.current;
  }
}

export const signal = <T>(initial: T): Signal<T> => new Signal(initial);

function release(computation: Computation): void {
  for (const child of computation.children) dispose(child);
  computation.children.clear();
  for (const cleanup of computation.cleanups.splice(0)) cleanup();
  for (const source of computation.sources) source.delete(computation);
  computation.sources.clear();
}

function dispose(computation: Computation): void {
  computation.disposed = true;
  release(computation);
}

export function effect(fn: () => void): Cleanup {
  const owner = active;
  const computation: Computation = {
    sources: new Set(),
    children: new Set(),
    cleanups: [],
    disposed: false,
    run() {
      release(computation);
      const previous = active;
      active = computation;
      try {
        fn();
      } finally {
        active = previous;
      }
    },
  };
  owner?.children.add(computation);
  computation.run();
  return () => dispose(computation);
}

/** 目前 effect 重跑或釋放前執行 */
export function onCleanup(fn: Cleanup): void {
  active?.cleanups.push(fn);
}

export function computed<T>(fn: () => T): { readonly value: T } {
  const result = new Signal<T>(undefined as T);
  effect(() => {
    result.value = fn();
  });
  return result;
}

export function batch(fn: () => void): void {
  batching++;
  try {
    fn();
  } finally {
    batching--;
    if (batching === 0) flush();
  }
}

export function untracked<T>(fn: () => T): T {
  const previous = active;
  active = null;
  try {
    return fn();
  } finally {
    active = previous;
  }
}
