import { AppException } from './errors.js';
import { decodeCursor, encodeCursor, paginationQuerySchema, toPage } from './pagination.js';

describe('pagination', () => {
  it('applies defaults and caps the limit at 100', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(paginationQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    expect(paginationQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('round trips a cursor and rejects garbage', () => {
    const cursor = encodeCursor({ id: 7, at: '2026-01-01' });
    expect(decodeCursor(cursor)).toEqual({ id: 7, at: '2026-01-01' });
    expect(() => decodeCursor('@@@')).toThrow(AppException);
  });

  it('returns a cursor only when another page exists', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const first = toPage(rows, 2, (r) => ({ id: r.id }));
    expect(first.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(decodeCursor(first.nextCursor!)).toEqual({ id: 2 });

    const last = toPage(rows.slice(0, 2), 2, (r) => ({ id: r.id }));
    expect(last.nextCursor).toBeNull();
  });
});
