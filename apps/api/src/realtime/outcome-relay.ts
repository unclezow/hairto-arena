import { Injectable, OnModuleInit } from '@nestjs/common';
import { ArenaClient } from '../near/arena.client.js';
import { OutcomeStream, relayedOutcome } from './outcome-stream.js';

/**
 * Worker: pushes the duel logs of every bot and keeper transaction it sends to the arena into `chain:outcomes`,
 * from the outcome near-kit returned for its own send, so the live duel view hears them within a second.
 */
@Injectable()
export class OutcomeRelay implements OnModuleInit {
  constructor(
    private readonly arena: ArenaClient,
    private readonly stream: OutcomeStream,
  ) {}

  onModuleInit() {
    this.arena.onOutcome((outcome) =>
      this.stream.pushQuietly(relayedOutcome(outcome, this.arena.contractId)),
    );
  }
}
