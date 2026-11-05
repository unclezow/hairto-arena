import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { normalizeSeed, type Seed } from './seed.js';

const PREFIX = 'enc:v1:';

/** AES-256-GCM, so an unrevealed seed in the database is useless without the key and cannot be altered. */
export function encryptSeed(seed: Seed, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(seed, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${body.toString('hex')}`;
}

export function isEncryptedSeed(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Accepts a plain revealed seed too (hex or base64: the sync job stores the seed in clear once it is public). */
export function decryptSeed(value: string, key: Buffer): Seed {
  if (!isEncryptedSeed(value)) return normalizeSeed(value);
  const [iv, tag, body] = value.slice(PREFIX.length).split(':');
  if (!iv || !tag || !body) throw new Error('Malformed encrypted seed');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  const seed = Buffer.concat([
    decipher.update(Buffer.from(body, 'hex')),
    decipher.final(),
  ]).toString('utf8');
  return normalizeSeed(seed);
}
