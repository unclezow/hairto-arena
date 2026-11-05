/** pino redact paths. Secrets (bot seeds, keys, session tokens) must never reach the logs. */
export const LOG_REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.signature',
  'req.body.seed',
  'seed',
  'privateKey',
  'authorization',
  'token',
  '*.seed',
  '*.privateKey',
  '*.authorization',
  '*.token',
];
