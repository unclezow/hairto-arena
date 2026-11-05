import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderSchema } from './db/tables.js';

/** `pnpm --filter @hairto-arena/indexer schema`: rewrites sql/schema.sql from the table definitions. */
const target = new URL('../sql/schema.sql', import.meta.url);
mkdirSync(fileURLToPath(new URL('.', target)), { recursive: true });
writeFileSync(fileURLToPath(target), renderSchema());
