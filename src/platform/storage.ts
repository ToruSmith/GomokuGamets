/** localStorage 在私密模式或被封鎖時會丟例外，遊戲不該因此壞掉。 */
const PREFIX = 'gomoku.v2.';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 寫不進去就只在這次瀏覽中有效
  }
}

export function erase(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // 同上
  }
}
