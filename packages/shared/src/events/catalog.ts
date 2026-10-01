// Event catalog rules (CLAUDE.md 7.2). The catalog itself comes from `events.allowed` of
// each version; the seven base events are the floor every version must keep, because
// the analytics (11.2) is defined in terms of them.
export const BASE_EVENTS = [
  'session_started',
  'step_viewed',
  'answer_submitted',
  'step_completed',
  'back_clicked',
  'result_viewed',
  'cta_clicked',
] as const;
