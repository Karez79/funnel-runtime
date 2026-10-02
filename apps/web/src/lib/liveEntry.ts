// One parser for a message of the live stream (CLAUDE.md 11.1), shared by the Live events
// page and the top-bar indicator: the stream only sends entries, so anything that is not
// JSON or does not match LiveEntrySchema is dropped rather than thrown.
import { LiveEntrySchema, LiveHelloSchema, type LiveEntry } from '@funnel/shared';
import type { z } from 'zod';

function parseWith<S extends z.ZodType>(schema: S, data: string): z.infer<S> | null {
  try {
    const parsed = schema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const parseLiveEntry = (data: string): LiveEntry | null => parseWith(LiveEntrySchema, data);

/** The `boot` of the server process from the stream's `hello` event. */
export const parseLiveBoot = (data: string): string | null =>
  parseWith(LiveHelloSchema, data)?.boot ?? null;
