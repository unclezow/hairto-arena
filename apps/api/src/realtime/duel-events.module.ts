import { Module } from '@nestjs/common';
import { damageStrategyProvider } from '../duels/damage/damage.provider.js';
import { DUEL_EVENT_SOURCE, OutcomeEventSource } from './duel-chain-events.js';
import { DuelEventPublisher } from './duel-event-publisher.service.js';
import { DuelLiveStore } from './duel-live.js';
import { OutcomeRelay } from './outcome-relay.js';
import { OutcomeStream } from './outcome-stream.js';

/**
 * Worker side of realtime: relays the outcomes of its own arena transactions to `chain:outcomes`, and publishes
 * the duel events found there to Redis.
 */
@Module({
  providers: [
    DuelEventPublisher,
    DuelLiveStore,
    damageStrategyProvider,
    OutcomeStream,
    OutcomeRelay,
    OutcomeEventSource,
    { provide: DUEL_EVENT_SOURCE, useExisting: OutcomeEventSource },
  ],
})
export class DuelEventsModule {}
