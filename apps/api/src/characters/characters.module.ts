import { Module } from '@nestjs/common';
import { CharactersController } from './characters.controller.js';
import { CharactersService } from './characters.service.js';

/** FreshnessService comes from the global ReadModelModule. */
@Module({
  controllers: [CharactersController],
  providers: [CharactersService],
  exports: [CharactersService],
})
export class CharactersModule {}
