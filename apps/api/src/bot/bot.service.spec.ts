import type { RedisService } from '../redis/redis.service.js';
import type { BotDuelService } from './bot-duel.service.js';
import { BotChainError } from './bot-gateway.js';
import { BotService } from './bot.service.js';

function setup(issue: () => Promise<unknown>) {
  const published: { channel: string; message: unknown }[] = [];
  const redis = {
    publish: vi.fn(async (channel: string, message: unknown) => {
      published.push({ channel, message });
      return 1;
    }),
  } as unknown as RedisService;
  const duels = { issueTicket: vi.fn(issue) } as unknown as BotDuelService;
  const service = new BotService(
    redis,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    duels,
    {} as never,
  );
  return { service, published, duels };
}

const request = (over: object = {}) =>
  JSON.stringify({
    requestId: 'r1',
    type: 'issue-ticket',
    fighter: 'fighter.testnet',
    assetId: 2,
    botLevel: 2,
    ...over,
  });

describe('BotService.handleRequest', () => {
  it('answers a ticket request on the reply channel of the request', async () => {
    const issued = { ticket: { nonce: 0 }, signature: 'c2ln', deadlineMs: 55_000 };
    const s = setup(async () => issued);
    const reply = await s.service.handleRequest(request());
    expect(reply).toEqual({ requestId: 'r1', ok: true, ...issued });
    expect(s.published[0]!.channel).toBe('bot:replies:r1');
    expect(s.duels.issueTicket).toHaveBeenCalledWith({
      fighter: 'fighter.testnet',
      assetId: 2,
      botLevel: 2,
    });
  });

  it('passes the reason code of a refused ticket through', async () => {
    const s = setup(async () => {
      throw new BotChainError('ORACLE_UNAVAILABLE', 'No fresh on-chain price for asset 2');
    });
    await expect(s.service.handleRequest(request())).resolves.toMatchObject({
      ok: false,
      code: 'ORACLE_UNAVAILABLE',
    });
  });

  it('rejects a malformed request without asking for a ticket', async () => {
    const s = setup(async () => ({}));
    await expect(
      s.service.handleRequest(request({ fighter: 'Not An Account!' })),
    ).resolves.toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    await expect(s.service.handleRequest('{')).resolves.toMatchObject({ code: 'BAD_REQUEST' });
    expect(s.duels.issueTicket).not.toHaveBeenCalled();
  });
});
