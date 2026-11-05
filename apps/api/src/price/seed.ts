import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from '../core/core.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { seedArenas } from './seed-arenas.js';

@Module({ imports: [CoreModule] })
class SeedModule {}

/** `pnpm db:seed`: creates the market feeds and arenas (idempotent). */
const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['warn', 'error'] });
try {
  await seedArenas(app.get(PrismaService));
  console.log('Seeded market feeds and arenas');
} finally {
  await app.close();
}
