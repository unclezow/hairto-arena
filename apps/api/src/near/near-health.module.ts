import { Module } from '@nestjs/common';
import { NearHealthReporter } from './near-health.service.js';

/** Worker only: reports the gas keys' lanes and balances for `/health/near`. */
@Module({ providers: [NearHealthReporter] })
export class NearHealthModule {}
