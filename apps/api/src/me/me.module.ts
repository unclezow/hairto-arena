import { Module } from '@nestjs/common';
import { DUEL_CHAIN_READER, NearDuelReader } from '../duels/duel-chain-reader.js';
import { SeasonsModule } from '../seasons/seasons.module.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';

@Module({
  imports: [SeasonsModule],
  controllers: [MeController],
  providers: [
    MeService,
    NearDuelReader,
    { provide: DUEL_CHAIN_READER, useExisting: NearDuelReader },
  ],
})
export class MeModule {}
