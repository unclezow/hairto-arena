import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AbuseJobModule } from './abuse/abuse.module.js';
import { BotModule } from './bot/bot.module.js';
import { CoreModule } from './core/core.module.js';
import { DuelSettlerModule } from './duels/duel-settler.module.js';
import { DuelEventsModule } from './realtime/duel-events.module.js';
import { IndexerSyncModule } from './indexer-sync/indexer-sync.module.js';
import { LeaderboardPublisherModule } from './leaderboard/leaderboard-publisher.module.js';
import { KeeperModule } from './keeper/keeper.module.js';
import { NearHealthModule } from './near/near-health.module.js';
import { PriceModule } from './price/price.module.js';
import { ReadModelModule } from './read-model/read-model.module.js';

/**
 * Background jobs: bot service, price pusher, settler, keeper (entrypoint: worker.ts). It is the only process that
 * holds the gas keys, because near-kit caches their nonces per process. It also copies the indexer's schema
 * `chain` into the read model.
 */
@Module({
  imports: [
    CoreModule,
    ScheduleModule.forRoot(),
    NearHealthModule,
    BotModule,
    AbuseJobModule,
    PriceModule,
    KeeperModule,
    IndexerSyncModule,
    DuelSettlerModule,
    DuelEventsModule,
    ReadModelModule,
    LeaderboardPublisherModule,
  ],
})
export class WorkerModule {}
