import { Module } from '@nestjs/common';
import { damageStrategyProvider } from '../duels/damage/damage.provider.js';
import { DUEL_EVENT_SOURCE, PendingDuelEventSource } from './duel-chain-events.js';
import { DuelEventPublisher } from './duel-event-publisher.service.js';
import { DuelLiveStore } from './duel-live.js';

/** Worker side of realtime: follows DuelManager and publishes duel events to Redis. */
@Module({
  providers: [
    DuelEventPublisher,
    DuelLiveStore,
    damageStrategyProvider,
    PendingDuelEventSource,
    { provide: DUEL_EVENT_SOURCE, useExisting: PendingDuelEventSource },
  ],
})
export class DuelEventsModule {}
