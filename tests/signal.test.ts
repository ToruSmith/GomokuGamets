import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { batch, computed, effect, onCleanup, signal, untracked } from '../src/state/signal.ts';

describe('signal', () => {
  it('effect 依賴改變時重跑，相同值不觸發', () => {
    const count = signal(0);
    const seen: number[] = [];
    effect(() => seen.push(count.value));
    count.value = 1;
    count.value = 1;
    assert.deepEqual(seen, [0, 1]);
  });

  it('條件分支切換後舊依賴不再觸發', () => {
    const flag = signal(true);
    const a = signal(1);
    let runs = 0;
    effect(() => {
      runs++;
      if (flag.value) void a.value;
    });
    flag.value = false;
    a.value = 2;
    assert.equal(runs, 2);
  });

  it('重跑時釋放子 effect 與清理函式', () => {
    const outer = signal(0);
    const inner = signal(0);
    let innerRuns = 0;
    let cleaned = 0;
    effect(() => {
      void outer.value;
      onCleanup(() => cleaned++);
      effect(() => {
        void inner.value;
        innerRuns++;
      });
    });
    outer.value = 1;
    assert.equal(cleaned, 1);
    innerRuns = 0;
    inner.value = 1;
    assert.equal(innerRuns, 1, '只有最新的子 effect 會跑');
  });

  it('batch 合併更新', () => {
    const a = signal(0);
    const b = signal(0);
    let runs = 0;
    effect(() => {
      void a.value;
      void b.value;
      runs++;
    });
    batch(() => {
      a.value = 1;
      b.value = 1;
    });
    assert.equal(runs, 2);
  });

  it('computed 與 untracked', () => {
    const a = signal(2);
    const doubled = computed(() => a.value * 2);
    assert.equal(doubled.value, 4);
    a.value = 3;
    assert.equal(doubled.value, 6);
    let runs = 0;
    effect(() => {
      runs++;
      untracked(() => a.value);
    });
    a.value = 4;
    assert.equal(runs, 1);
  });
});
