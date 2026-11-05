import { Module } from '@nestjs/common';
import { LeaderboardPublisher } from './leaderboard-publisher.service.js';

/** Worker side of the leaderboard: pushes it to the season room. The REST side is LeaderboardModule. */
@Module({ providers: [LeaderboardPublisher] })
export class LeaderboardPublisherModule {}
