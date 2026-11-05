import { Controller, Get, Header, Param } from '@nestjs/common';
import { ParseAccountIdPipe } from '../common/zod-validation.pipe.js';
import { FreshnessService } from '../read-model/freshness.service.js';
import { CharactersService } from './characters.service.js';

/** Character reads (cosmetic). There are deliberately no write routes: buy and equip are wallet transactions. */
@Controller()
export class CharactersController {
  constructor(
    private readonly characters: CharactersService,
    private readonly freshness: FreshnessService,
  ) {}

  @Get('characters')
  @Header('Cache-Control', 'public, max-age=3')
  async catalog() {
    const [items, freshness] = await Promise.all([this.characters.catalog(), this.freshness.get()]);
    return { items, ...freshness };
  }

  @Get('wallets/:accountId/characters')
  @Header('Cache-Control', 'public, max-age=3')
  async ofWallet(@Param('accountId', ParseAccountIdPipe) accountId: string) {
    const [wallet, freshness] = await Promise.all([
      this.characters.ofWallet(accountId),
      this.freshness.get(),
    ]);
    return { ...wallet, ...freshness };
  }
}
