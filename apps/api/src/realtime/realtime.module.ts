import { Module } from '@nestjs/common';
import { damageStrategyProvider } from '../duels/damage/damage.provider.js';
import { DuelLiveStore } from './duel-live.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { SnapshotService } from './snapshot.service.js';

/** API side of realtime: the Socket.IO gateway. The duel event publisher runs in the worker. */
@Module({
  providers: [RealtimeGateway, SnapshotService, DuelLiveStore, damageStrategyProvider],
})
export class RealtimeModule {}
