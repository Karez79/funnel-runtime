import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJson, remove, writeJson } from './storage.ts';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storage', () => {
  it('round-trips JSON values and removes them', () => {
    vi.stubGlobal('window', { localStorage: memoryStorage() });
    writeJson('k', { a: [1, 'x'] });
    expect(readJson('k')).toEqual({ a: [1, 'x'] });
    remove('k');
    expect(readJson('k')).toBeUndefined();
  });

  it('returns undefined for broken JSON', () => {
    const storage = memoryStorage();
    storage.setItem('k', '{not json');
    vi.stubGlobal('window', { localStorage: storage });
    expect(readJson('k')).toBeUndefined();
  });

  it('never throws when storage is disabled or full', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(readJson('k')).toBeUndefined();
    expect(() => {
      writeJson('k', 1);
      remove('k');
    }).not.toThrow();

    const full = memoryStorage();
    const fail = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    full.setItem = fail;
    full.removeItem = fail;
    vi.stubGlobal('window', { localStorage: full });
    expect(() => {
      writeJson('k', 1);
      remove('k');
    }).not.toThrow();
  });
});
