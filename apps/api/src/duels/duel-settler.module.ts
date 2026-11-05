import { Module } from '@nestjs/common';
import { DuelSettler } from './duel-settler.service.js';
import { NearSettler, SETTLER_CHAIN } from './settler-chain.js';

/** Worker side of duels: settle, forfeit, void and prune. */
@Module({
  providers: [DuelSettler, NearSettler, { provide: SETTLER_CHAIN, useExisting: NearSettler }],
})
export class DuelSettlerModule {}
