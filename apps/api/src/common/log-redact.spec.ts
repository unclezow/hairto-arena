import { Writable } from 'node:stream';
import { pino } from 'pino';
import { LOG_REDACT } from './log-redact.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = pino({ redact: { paths: LOG_REDACT, censor: '[redacted]' } }, stream);
  return { logger, output: () => lines.join('') };
}

describe('log redaction', () => {
  it.each(['seed', 'privateKey', 'authorization'])('redacts a top level %s', (field) => {
    const { logger, output } = capture();
    logger.info({ [field]: 'super-secret' }, 'msg');
    expect(output()).not.toContain('super-secret');
    expect(output()).toContain('[redacted]');
  });

  it('redacts nested secrets and the authorization header', () => {
    const { logger, output } = capture();
    logger.info(
      { duel: { seed: 'nested-seed' }, req: { headers: { authorization: 'Bearer abc' } } },
      'msg',
    );
    expect(output()).not.toContain('nested-seed');
    expect(output()).not.toContain('Bearer abc');
  });
});
