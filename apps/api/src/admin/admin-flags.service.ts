import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { badRequest, notFound } from '../common/errors.js';
import { RuntimeFlagsService, type FlagName } from '../flags/runtime-flags.service.js';
import { AuditService, type AuditContext } from './audit.service.js';

export const EDITABLE_FLAGS: readonly FlagName[] = [
  'DUELS_ENABLED',
  'KEEPER_ENABLED',
  'KEEPER_DRY_RUN',
];

@Injectable()
export class AdminFlagsService {
  constructor(
    private readonly flags: RuntimeFlagsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async list() {
    const editable = await Promise.all(
      EDITABLE_FLAGS.map(async (name) => {
        const override = await this.flags.override(name);
        return {
          name,
          value: await this.flags.get(name),
          source: override === null ? 'environment' : 'override',
          editable: true,
        };
      }),
    );
    // Which oracle feeds the chain is decided at deploy time; switching it live would split the price history.
    return [
      ...editable,
      {
        name: 'ORACLE_MODE',
        value: this.config.get('PRICE_SOURCE', { infer: true }),
        source: 'environment',
        editable: false,
      },
    ];
  }

  async set(ctx: AuditContext, name: string, value: boolean) {
    if (name === 'ORACLE_MODE') throw badRequest('ORACLE_MODE is read only');
    if (!EDITABLE_FLAGS.includes(name as FlagName)) throw notFound('No such flag');
    const flag = name as FlagName;

    const before = await this.flags.get(flag);
    return this.audit.run(ctx, 'flag.set', `flag:${flag}`, async () => {
      // Redis is not part of the database transaction, so a failed write throws and the audit row is rolled back.
      await this.flags.set(flag, value);
      return { before: { value: before }, after: { value }, result: { name: flag, value } };
    });
  }
}
