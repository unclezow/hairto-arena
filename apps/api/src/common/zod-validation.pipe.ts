import { Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { ACCOUNT_ID_PATTERN } from './account-id.js';
import { badRequest } from './errors.js';

export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw badRequest(
        'Validation failed',
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return result.data;
  }
}

/** A NEAR account id. Accepts any case and returns the lowercase form used everywhere in the API. */
export const accountIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(ACCOUNT_ID_PATTERN, 'invalid account id');

@Injectable()
export class ParseAccountIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const result = accountIdSchema.safeParse(value);
    if (!result.success)
      throw badRequest('Invalid account id', [{ path: '', message: 'invalid account id' }]);
    return result.data;
  }
}
