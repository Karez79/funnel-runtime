// localStorage that never throws (CLAUDE.md 8.1): private mode, a full quota or a
// disabled storage must not break the funnel; the server stays the source of truth.
// Values are JSON and come back as `unknown`, so every reader validates them.

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readJson(key: string): unknown {
  try {
    const raw = store()?.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    store()?.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or disabled storage: the next server read restores the state.
  }
}

export function remove(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
