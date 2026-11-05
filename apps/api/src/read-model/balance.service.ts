import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface Principal {
  fighter: bigint;
  backer: bigint;
}

export interface Tvl extends Principal {
  /** Accounts holding a positive balance in the Fighter pool. */
  fighterCount: number;
  /** Accounts holding a positive balance in the Backer pool. */
  backerCount: number;
}

interface PrincipalRow {
  vault: string;
  principal: string;
}

/** The net effect of one deposit row on principal. A constant, so it is safe to inline as SQL. */
const NET = Prisma.raw(
  `CASE action WHEN 'DEPOSIT' THEN amount WHEN 'WITHDRAW' THEN -amount ELSE 0 END`,
);

/** Principal per vault, from the deposit events. Claims of yield do not touch principal. */
@Injectable()
export class BalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async principalOf(address: string): Promise<Principal> {
    const rows = await this.prisma.$queryRaw<PrincipalRow[]>`
      SELECT vault::text AS vault, COALESCE(SUM(${NET}), 0)::text AS principal
      FROM deposits WHERE address = ${address} GROUP BY vault`;
    return this.toPrincipal(rows);
  }

  async tvl(): Promise<Tvl> {
    const rows = await this.prisma.$queryRaw<PrincipalRow[]>`
      SELECT vault::text AS vault, COALESCE(SUM(${NET}), 0)::text AS principal
      FROM deposits GROUP BY vault`;
    const holders = await this.prisma.$queryRaw<{ vault: string; count: number }[]>`
      SELECT vault::text AS vault, count(*)::int AS count FROM (
        SELECT vault, address FROM deposits GROUP BY vault, address HAVING SUM(${NET}) > 0
      ) holders GROUP BY vault`;
    const countOf = (vault: string) => holders.find((h) => h.vault === vault)?.count ?? 0;
    return {
      ...this.toPrincipal(rows),
      fighterCount: countOf('FIGHTER'),
      backerCount: countOf('BACKER'),
    };
  }

  private toPrincipal(rows: PrincipalRow[]): Principal {
    const out: Principal = { fighter: 0n, backer: 0n };
    for (const r of rows) {
      const value = BigInt(r.principal);
      if (r.vault === 'FIGHTER') out.fighter = value;
      if (r.vault === 'BACKER') out.backer = value;
    }
    return out;
  }
}
