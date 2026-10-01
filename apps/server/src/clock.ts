// Time is a dependency, not a global: services take a clock so tests can move it
// (session TTL, "in progress" windows) without fake timers.
export interface Clock {
  now: () => Date;
}

export const systemClock: Clock = { now: () => new Date() };
