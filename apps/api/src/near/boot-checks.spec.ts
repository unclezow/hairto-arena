import { ConfigService } from '@nestjs/config';
import { generateKey } from 'near-kit';
import { validateEnv } from '../config/env.js';
import type { ArenaClient } from './arena.client.js';
import type { BotView } from './arena.types.js';
import { checkBotSetup } from './boot-checks.js';
import { NearService } from './near.service.js';

const ticket = generateKey();
const bot1 = generateKey();
const bot2 = generateKey();

function near(raw: Record<string, string>) {
  return new NearService(new ConfigService(validateEnv(raw)) as never);
}

function arena(bots: Record<number, BotView | null>, serviceKey = ticket.publicKey.toString()) {
  return {
    botServiceKey: vi.fn(async () => serviceKey),
    getBot: vi.fn(async (level: number) => bots[level] ?? null),
  } as unknown as ArenaClient;
}

const configured = {
  BOT_SERVICE_TICKET_KEY: ticket.secretKey,
  BOT_LV1_GAS_KEY: bot1.secretKey,
  BOT_LV2_GAS_KEY: bot2.secretKey,
};

describe('checkBotSetup', () => {
  it('serves every level whose account matches the arena', async () => {
    const report = await checkBotSetup(
      near(configured),
      arena({
        1: { level: 1, account_id: 'rookie.bots.hairto.testnet', active: true },
        2: { level: 2, account_id: 'trend.bots.hairto.testnet', active: false },
      }),
    );
    expect(report).toEqual({
      levels: [1, 2],
      ticketKeyOk: true,
      problems: [],
      warnings: ['bot level 2 is inactive in the arena'],
    });
  });

  it('drops a level whose account differs from the arena', async () => {
    const report = await checkBotSetup(
      near({ ...configured, BOT_LV2_ACCOUNT_ID: 'other.testnet' }),
      arena({
        1: { level: 1, account_id: 'rookie.bots.hairto.testnet', active: true },
        2: { level: 2, account_id: 'trend.bots.hairto.testnet', active: true },
      }),
    );
    expect(report.levels).toEqual([1]);
    expect(report.problems).toEqual([
      expect.stringContaining('bot level 2: the arena has trend.bots'),
    ]);
  });

  it('serves nothing when the ticket key is not the arena bot service key', async () => {
    const report = await checkBotSetup(
      near(configured),
      arena(
        { 1: { level: 1, account_id: 'rookie.bots.hairto.testnet', active: true } },
        generateKey().publicKey.toString(),
      ),
    );
    expect(report.ticketKeyOk).toBe(false);
    expect(report.levels).toEqual([]);
    expect(report.problems[0]).toMatch(/not the arena's bot service key/);
  });

  it('reports a missing ticket key and an unregistered level', async () => {
    const report = await checkBotSetup(near({ BOT_LV1_GAS_KEY: bot1.secretKey }), arena({}));
    expect(report.ticketKeyOk).toBe(false);
    expect(report.problems).toEqual([
      expect.stringContaining('BOT_SERVICE_TICKET_KEY is not set'),
      expect.stringContaining('bot level 1: the arena has no bot'),
    ]);
  });
});
