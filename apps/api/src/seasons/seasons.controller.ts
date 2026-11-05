import { Controller, Get, Header, Param } from '@nestjs/common';
import { ParseAccountIdPipe } from '../common/zod-validation.pipe.js';
import { SeasonsService } from './seasons.service.js';

/** `:id` is a season number or the word `current`. */
@Controller('seasons')
export class SeasonsController {
  constructor(private readonly seasons: SeasonsService) {}

  @Get('current')
  @Header('Cache-Control', 'public, max-age=3')
  current() {
    return this.seasons.view('current');
  }

  @Get(':id')
  @Header('Cache-Control', 'public, max-age=3')
  get(@Param('id') id: string) {
    return this.seasons.view(id);
  }

  /** Where the pot comes from: what the vaults paid in, and an estimate that says what it assumes. */
  @Get(':id/pot')
  @Header('Cache-Control', 'public, max-age=3')
  pot(@Param('id') id: string) {
    return this.seasons.potOf(id);
  }

  /** The prize table with amounts per rank. */
  @Get(':id/prizes')
  @Header('Cache-Control', 'public, max-age=3')
  prizes(@Param('id') id: string) {
    return this.seasons.prizes(id);
  }

  /** Posted, claimed and unclaimed totals of a season. */
  @Get(':id/claims')
  @Header('Cache-Control', 'public, max-age=3')
  claims(@Param('id') id: string) {
    return this.seasons.claims(id);
  }

  /** Merkle proof for a fighter prize or backer bonus claim. */
  @Get(':id/results/:accountId')
  @Header('Cache-Control', 'no-store')
  result(@Param('id') id: string, @Param('accountId', ParseAccountIdPipe) accountId: string) {
    return this.seasons.result(id, accountId);
  }
}
