// Raw answers are operational data for restoring a session, not analytics (CLAUDE.md 5):
// once a session expires they are erased from `state_json`, while the session row and
// its events stay for analytics. Runs at startup and then every hour.
import type { FastifyBaseLogger } from 'fastify';
import type { Clock } from '../../clock.ts';
import type { RetentionRepo } from './repo.ts';

const HOUR_MS = 60 * 60 * 1000;

export function createRetentionService(repo: RetentionRepo, clock: Clock, log: FastifyBaseLogger) {
  function sweep(): number {
    const cleared = repo.clearExpiredAnswers(clock.now().toISOString());
    if (cleared > 0) log.info({ cleared }, 'cleared answers of expired sessions');
    return cleared;
  }

  return {
    sweep,

    /** Sweeps now and every `intervalMs`; the returned function stops the timer. */
    start(intervalMs = HOUR_MS): () => void {
      sweep();
      const timer = setInterval(() => {
        try {
          sweep();
        } catch (err) {
          log.error({ err }, 'expired answers cleanup failed');
        }
      }, intervalMs);
      // Never keeps the process alive on its own (shutdown, tests).
      timer.unref();
      return () => {
        clearInterval(timer);
      };
    },
  };
}
