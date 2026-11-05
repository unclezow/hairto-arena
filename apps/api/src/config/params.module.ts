import { Global, Module } from '@nestjs/common';
import { ParamsService } from './params.service.js';

@Global()
@Module({
  providers: [ParamsService],
  exports: [ParamsService],
})
export class ParamsModule {}
