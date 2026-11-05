import { Injectable } from '@nestjs/common';
import { RuntimeFlagsService } from '../flags/runtime-flags.service.js';

/** `live` sends transactions, `dry-run` computes and stores but sends nothing, `off` does nothing. */
export type KeeperMode = 'live' | 'dry-run' | 'off';

@Injectable()
export class KeeperModeService {
  constructor(private readonly flags: RuntimeFlagsService) {}

  async get(): Promise<KeeperMode> {
    if (await this.flags.get('KEEPER_DRY_RUN')) return 'dry-run';
    return (await this.flags.get('KEEPER_ENABLED')) ? 'live' : 'off';
  }
}
