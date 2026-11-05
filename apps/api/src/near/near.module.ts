import { Global, Module } from '@nestjs/common';
import { ArenaClient } from './arena.client.js';
import { NearService } from './near.service.js';
import { UsdcClient } from './usdc.client.js';
import { VaultClient } from './vault.client.js';

@Global()
@Module({
  providers: [NearService, ArenaClient, VaultClient, UsdcClient],
  exports: [NearService, ArenaClient, VaultClient, UsdcClient],
})
export class NearModule {}
