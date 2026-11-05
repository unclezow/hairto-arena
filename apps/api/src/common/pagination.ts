import { z } from 'zod';
import { badRequest } from './errors.js';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T = unknown>(cursor: string): T {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw badRequest('Invalid cursor', [{ path: 'cursor', message: 'invalid cursor' }]);
  }
}

/** Fetch `limit + 1` rows, then pass them here; the extra row only signals that another page exists. */
export function toPage<T>(rows: T[], limit: number, cursorOf: (last: T) => unknown): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null };
}
