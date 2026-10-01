import { describe, expect, it } from 'vitest';
import { startingState, type Mirror } from './session.ts';

const server = {
  id: 's1',
  stateRev: 3,
  state: { answers: { team_size: 4 }, history: ['intro'], currentStepId: 'team_size' },
};
const local = {
  answers: { team_size: 4, work_mode: 'remote' },
  history: ['intro', 'team_size'],
  currentStepId: 'work_mode',
};
const mirror = (patch: Partial<Mirror>): Mirror => ({
  sessionId: 's1',
  state: local,
  stateRev: 3,
  dirty: true,
  ...patch,
});

describe('startingState', () => {
  it('keeps unsaved local changes made on the server revision', () => {
    expect(startingState(server, mirror({}))).toEqual({ state: local, unsaved: true });
  });

  it('takes the server state when it has a larger revision', () => {
    expect(startingState(server, mirror({ stateRev: 2 }))).toEqual({
      state: server.state,
      unsaved: false,
    });
  });

  it('takes the server state when the mirror is clean, absent or of another session', () => {
    for (const m of [mirror({ dirty: false }), mirror({ sessionId: 's2' }), undefined]) {
      expect(startingState(server, m)).toEqual({ state: server.state, unsaved: false });
    }
  });
});
