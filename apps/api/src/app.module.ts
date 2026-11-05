import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { CharactersModule } from './characters/characters.module.js';
import { CoreModule } from './core/core.module.js';
import { DuelsModule } from './duels/duels.module.js';
import { FightersModule } from './fighters/fighters.module.js';
import { HealthModule } from './health/health.module.js';
import { LeaderboardModule } from './leaderboard/leaderboard.module.js';
import { MeModule } from './me/me.module.js';
import { PriceStatusModule } from './price/oracle-status.service.js';
import { PublicConfigModule } from './public-config/public-config.module.js';
import { ReadModelModule } from './read-model/read-model.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { SeasonsModule } from './seasons/seasons.module.js';

/** HTTP API + WebSocket gateway (entrypoint: main.ts). */
@Module({
  imports: [
    CoreModule,
    HealthModule,
    RealtimeModule,
    PriceStatusModule,
    FightersModule,
    CharactersModule,
    DuelsModule,
    LeaderboardModule,
    SeasonsModule,
    MeModule,
    PublicConfigModule,
    ReadModelModule,
    AdminModule,
  ],
})
export class AppModule {}
