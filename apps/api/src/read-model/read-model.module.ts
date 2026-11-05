import { Global, Module } from '@nestjs/common';
import { BalanceService } from './balance.service.js';
import { WalletStatusService } from './wallet-status.service.js';
import { FreshnessService } from './freshness.service.js';
import { ScoreboardService } from './scoreboard.service.js';
import { SeasonLookup } from './season-lookup.service.js';

/** Queries over the synced read model that several endpoints share. */
@Global()
@Module({
  providers: [
    FreshnessService,
    SeasonLookup,
    BalanceService,
    ScoreboardService,
    WalletStatusService,
  ],
  exports: [FreshnessService, SeasonLookup, BalanceService, ScoreboardService, WalletStatusService],
})
export class ReadModelModule {}
