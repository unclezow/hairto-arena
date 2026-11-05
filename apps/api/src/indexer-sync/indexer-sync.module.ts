import { Module } from '@nestjs/common';
import { IndexerSyncService } from './indexer-sync.service.js';

@Module({
  providers: [IndexerSyncService],
  exports: [IndexerSyncService],
})
export class IndexerSyncModule {}
