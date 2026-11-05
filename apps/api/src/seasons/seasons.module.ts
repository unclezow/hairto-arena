import { Module } from '@nestjs/common';
import { PotService } from './pot.service.js';
import { SeasonsController } from './seasons.controller.js';
import { SeasonsService } from './seasons.service.js';

@Module({
  controllers: [SeasonsController],
  providers: [SeasonsService, PotService],
  exports: [PotService, SeasonsService],
})
export class SeasonsModule {}
