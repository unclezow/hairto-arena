import { Module } from '@nestjs/common';
import { AbuseModule } from '../abuse/abuse.module.js';
import { PriceStatusModule } from '../price/oracle-status.service.js';
import { SeasonsModule } from '../seasons/seasons.module.js';
import { AdminArenasService } from './admin-arenas.service.js';
import { AdminBotsService } from './admin-bots.service.js';
import { AdminFlagsService } from './admin-flags.service.js';
import { AdminStatusService } from './admin-status.service.js';
import { AdminController } from './admin.controller.js';
import { FreshSignatureGuard } from './fresh-signature.guard.js';
import { NearParams, ON_CHAIN_PARAMS, ParamDriftService } from './param-drift.service.js';

@Module({
  imports: [AbuseModule, PriceStatusModule, SeasonsModule],
  controllers: [AdminController],
  providers: [
    AdminArenasService,
    AdminBotsService,
    AdminFlagsService,
    AdminStatusService,
    ParamDriftService,
    FreshSignatureGuard,
    NearParams,
    { provide: ON_CHAIN_PARAMS, useExisting: NearParams },
  ],
})
export class AdminModule {}
