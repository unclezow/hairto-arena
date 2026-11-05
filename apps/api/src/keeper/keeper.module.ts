import { Module } from '@nestjs/common';
import { AbuseModule } from '../abuse/abuse.module.js';
import { HarvestJob } from './harvest-job.service.js';
import { SeasonInputsLoader } from './inputs-loader.js';
import { KEEPER_CHAIN, NearKeeper } from './keeper-chain.js';
import { KeeperModeService } from './keeper-mode.js';
import { KeeperService } from './keeper.service.js';
import { SeasonKeeper } from './season-keeper.service.js';
import { SeasonVerifier } from './season-verifier.service.js';

@Module({
  imports: [AbuseModule],
  providers: [
    KeeperService,
    SeasonKeeper,
    HarvestJob,
    SeasonInputsLoader,
    KeeperModeService,
    SeasonVerifier,
    NearKeeper,
    { provide: KEEPER_CHAIN, useExisting: NearKeeper },
  ],
  exports: [SeasonVerifier],
})
export class KeeperModule {}
