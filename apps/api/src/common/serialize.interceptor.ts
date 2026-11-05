import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { Prisma } from '../generated/prisma/client.js';

/** Amounts are decimal strings in base units: bigint and Prisma Decimal values never reach JSON as numbers. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    // Not `constructor.name`: the Prisma runtime is bundled and its class names do not survive.
    if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toFixed();
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

@Injectable()
export class SerializeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(toJsonSafe));
  }
}
