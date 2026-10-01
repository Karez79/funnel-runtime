import { afterEach, describe, expect, it, vi } from 'vitest';
import { withViewTransition } from './viewTransition.ts';

function stubBrowser({ supported, reduced }: { supported: boolean; reduced: boolean }) {
  const classes = new Set<string>();
  let finish: () => void = () => undefined;
  const startViewTransition = vi.fn((update: () => void) => {
    update();
    return {
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    };
  });
  const documentElement = {
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      remove: (name: string) => classes.delete(name),
    },
  };
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal(
    'document',
    supported ? { documentElement, startViewTransition } : { documentElement },
  );
  return {
    classes,
    startViewTransition,
    finish: () => {
      finish();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('withViewTransition', () => {
  it('runs the update directly without support', () => {
    stubBrowser({ supported: false, reduced: false });
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledOnce();
  });

  it('runs the update directly with reduced motion', () => {
    const browser = stubBrowser({ supported: true, reduced: true });
    const update = vi.fn();
    withViewTransition(update, { back: true });
    expect(update).toHaveBeenCalledOnce();
    expect(browser.startViewTransition).not.toHaveBeenCalled();
    expect(browser.classes.size).toBe(0);
  });

  it('marks a back transition on <html> until it finishes', async () => {
    const browser = stubBrowser({ supported: true, reduced: false });
    const update = vi.fn();
    withViewTransition(update, { back: true });
    expect(update).toHaveBeenCalledOnce();
    expect(browser.classes.has('back')).toBe(true);
    browser.finish();
    await vi.waitFor(() => {
      expect(browser.classes.has('back')).toBe(false);
    });
  });

  it('an earlier transition finishing late keeps the class of the latest one', async () => {
    const browser = stubBrowser({ supported: true, reduced: false });
    withViewTransition(() => undefined, { back: true });
    const finishFirst = browser.finish;
    const second = stubBrowser({ supported: true, reduced: false });
    second.classes.add('back');
    withViewTransition(() => undefined, { back: true });
    finishFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(second.classes.has('back')).toBe(true);
    second.finish();
    await vi.waitFor(() => {
      expect(second.classes.has('back')).toBe(false);
    });
  });

  it('forward transitions clear a leftover back class', () => {
    const browser = stubBrowser({ supported: true, reduced: false });
    browser.classes.add('back');
    withViewTransition(() => undefined);
    expect(browser.classes.has('back')).toBe(false);
  });
});
