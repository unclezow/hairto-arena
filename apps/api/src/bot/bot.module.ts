import { Module } from '@nestjs/common';
import { BotAuditService } from './bot-audit.service.js';
import { BotDuelService } from './bot-duel.service.js';
import { BOT_GATEWAY, NearBotGateway } from './bot-gateway.js';
import { BotService } from './bot.service.js';
import { DuelRecorder } from './duel-recorder.js';
import { PricePrimer } from './price-primer.js';
import { RedisRunnerState } from './runner-state.js';
import { BotSeedStore } from './seed-store.js';
import { SeedRevealer } from './seed-revealer.service.js';
import { RedisTickFeed, TICK_SOURCE } from './tick-feed.js';

@Module({
  providers: [
    BotService,
    BotDuelService,
    BotAuditService,
    SeedRevealer,
    BotSeedStore,
    DuelRecorder,
    RedisRunnerState,
    PricePrimer,
    RedisTickFeed,
    { provide: TICK_SOURCE, useExisting: RedisTickFeed },
    NearBotGateway,
    { provide: BOT_GATEWAY, useExisting: NearBotGateway },
  ],
  exports: [BotAuditService, BotSeedStore],
})
export class BotModule {}
