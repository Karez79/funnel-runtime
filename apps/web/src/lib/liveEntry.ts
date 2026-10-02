// One parser for a message of the live stream (CLAUDE.md 11.1), shared by the Live events
// page and the top-bar indicator: the stream only sends entries, so anything that is not
// JSON or does not match LiveEntrySchema is dropped rather than thrown.
import { LiveEntrySchema, type LiveEntry } from '@funnel/shared';

export function parseLiveEntry(data: string): LiveEntry | null {
  try {
    const parsed = LiveEntrySchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
