import { Module } from '@nestjs/common';
import { BotAuditService } from '../bot/bot-audit.service.js';
import { CharactersModule } from '../characters/characters.module.js';
import { PriceStatusModule } from '../price/oracle-status.service.js';
import { BotClient } from './bot-client.js';
import { ChainDuelOverlay } from './chain-overlay.service.js';
import { damageStrategyProvider } from './damage/damage.provider.js';
import { DUEL_CHAIN_READER, NearDuelReader } from './duel-chain-reader.js';
import { DuelViewService } from './duel-view.service.js';
import { DuelsController, MyDuelsController } from './duels.controller.js';
import { DuelsService } from './duels.service.js';
import { EligibilityService } from './eligibility.service.js';
import { ReplayService } from './replay.service.js';
import { DuelOwnerGuard } from './duel-owner.guard.js';

/** HTTP side of duels. Signing seed tickets is the bot worker's job (see BotClient); the Fighter starts the duel. */
@Module({
  imports: [CharactersModule, PriceStatusModule],
  controllers: [DuelsController, MyDuelsController],
  providers: [
    DuelsService,
    DuelOwnerGuard,
    EligibilityService,
    DuelViewService,
    ChainDuelOverlay,
    ReplayService,
    BotClient,
    BotAuditService,
    damageStrategyProvider,
    NearDuelReader,
    { provide: DUEL_CHAIN_READER, useExisting: NearDuelReader },
  ],
})
export class DuelsModule {}
