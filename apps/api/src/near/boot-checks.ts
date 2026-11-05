import type { BotLevel } from '@hairto-arena/shared';
import { parseKey } from 'near-kit';
import type { ArenaClient } from './arena.client.js';
import type { NearService } from './near.service.js';

export interface BotSetupReport {
  /** Levels the worker may serve: a gas key is set and the arena has this very account for the level. */
  levels: BotLevel[];
  /** False when seed tickets cannot be signed for this arena; the bot module must then stay off. */
  ticketKeyOk: boolean;
  /** Human-readable reasons, one per failed check. */
  problems: string[];
  /** Not fatal, for example an inactive bot level. */
  warnings: string[];
}

/**
 * Compares the worker's bot setup with the arena: each configured bot account must be the account the arena has
 * for its level (`get_bot`), and the ticket key must be the arena's `bot_service_key`. A mismatched level is
 * dropped; a wrong or missing ticket key disables the whole bot module.
 */
export async function checkBotSetup(
  near: NearService,
  arena: ArenaClient,
): Promise<BotSetupReport> {
  const problems: string[] = [];
  const warnings: string[] = [];

  let ticketKeyOk = false;
  const ticketKey = near.ticketKey();
  if (!ticketKey) {
    problems.push('BOT_SERVICE_TICKET_KEY is not set, so no seed ticket can be signed');
  } else {
    const ours = parseKey(ticketKey).publicKey.toString();
    const registered = await arena.botServiceKey();
    if (registered === ours) {
      ticketKeyOk = true;
    } else {
      problems.push(
        `ticket key ${ours} is not the arena's bot service key ${registered}; ` +
          'fix BOT_SERVICE_TICKET_KEY or call set_bot_service_key',
      );
    }
  }

  const levels: BotLevel[] = [];
  for (const level of near.botLevels()) {
    const ours = near.accountOf(`bot:${level}`);
    const registered = await arena.getBot(level);
    if (!registered) {
      problems.push(`bot level ${level}: the arena has no bot; call set_bot(${level}, ${ours})`);
    } else if (registered.account_id !== ours) {
      problems.push(
        `bot level ${level}: the arena has ${registered.account_id}, this worker signs as ${ours}; ` +
          `fix BOT_LV${level}_ACCOUNT_ID or call set_bot`,
      );
    } else {
      levels.push(level);
      if (!registered.active) warnings.push(`bot level ${level} is inactive in the arena`);
    }
  }

  return { levels: ticketKeyOk ? levels : [], ticketKeyOk, problems, warnings };
}
