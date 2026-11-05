import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from '../core/core.module.js';
import { KeeperModule } from './keeper.module.js';
import { SeasonVerifier } from './season-verifier.service.js';

@Module({ imports: [CoreModule, KeeperModule] })
class VerifyModule {}

/** `pnpm season:verify <seasonId>`: exit code 0 when the posted roots match a fresh computation. */
const seasonId = Number(process.argv[2]);
if (!Number.isInteger(seasonId) || seasonId < 0) {
  console.error('Usage: pnpm season:verify <seasonId>');
  process.exit(2);
}

const app = await NestFactory.createApplicationContext(VerifyModule, { logger: ['error'] });
try {
  const v = await app.get(SeasonVerifier).verify(seasonId);
  console.log(
    JSON.stringify(v, (_k, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
  );
  process.exitCode = v.match ? 0 : 1;
} finally {
  await app.close();
}
