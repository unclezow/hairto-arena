import { Module } from '@nestjs/common';
import { FightersController } from './fighters.controller.js';
import { FightersService } from './fighters.service.js';

@Module({
  controllers: [FightersController],
  providers: [FightersService],
  exports: [FightersService],
})
export class FightersModule {}
