import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { IndexerSyncModule } from './indexer-sync.module.js';
import { IndexerSyncService } from './indexer-sync.service.js';

@Module({ imports: [CoreModule, IndexerSyncModule] })
class RebuildModule {}

/** `pnpm sync:rebuild`: empties mirrored tables, resets cursors, then replays until caught up. */
const app = await NestFactory.createApplicationContext(RebuildModule, {
  logger: ['log', 'warn', 'error'],
});
try {
  const sync = app.get(IndexerSyncService);
  await sync.rebuild();
  for (let run = 1; ; run++) {
    const report = await sync.runOnce();
    const copied = Object.values(report.copied).reduce((a, b) => a + b, 0);
    console.log(`run ${run}: copied ${copied} rows`, report.copied);
    if (report.skipped || report.stalled.length > 0 || copied === 0) break;
  }
} finally {
  await app.close();
}
