import { Global, Module } from '@nestjs/common';
import { NearService } from './near.service.js';

@Global()
@Module({
  providers: [NearService],
  exports: [NearService],
})
export class NearModule {}
