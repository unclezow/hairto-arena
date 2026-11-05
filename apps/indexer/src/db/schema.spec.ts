import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderSchema, TABLES } from './tables.js';

describe('schema chain', () => {
  it('sql/schema.sql is the output of renderSchema (pnpm --filter @hairto-arena/indexer schema)', () => {
    const file = readFileSync(
      fileURLToPath(new URL('../../sql/schema.sql', import.meta.url)),
      'utf8',
    );
    expect(file).toBe(renderSchema());
  });

  it('has the 16 handler tables, each with the sync cursor columns', () => {
    expect(Object.keys(TABLES)).toHaveLength(16);
    for (const spec of Object.values(TABLES)) {
      expect(spec.columns).toHaveProperty('blockHeight');
      expect(spec.columns).toHaveProperty('logIndex');
    }
  });
});
