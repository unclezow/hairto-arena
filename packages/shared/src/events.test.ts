import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTRACT_EVENT_NAMES, parseEventLog } from './events.js';

/** Variant names of the `event_json(standard = "hairto")` enum in a contract's events.rs, as snake_case. */
function contractEvents(crate: string): string[] {
  const url = new URL(`../../../contracts/${crate}/src/events.rs`, import.meta.url);
  const source = readFileSync(fileURLToPath(url), 'utf8');
  const body = source.split('event_json(standard = "hairto")')[1]!.split(/\n}\n/)[0]!;
  return [...body.matchAll(/^\s{4}([A-Z][A-Za-z]+)\s*[({,]/gm)].map((m) =>
    m[1]!.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(),
  );
}

describe('contract event names', () => {
  it.each(['arena', 'vault', 'characters'] as const)('match the %s contract', (crate) => {
    expect([...CONTRACT_EVENT_NAMES[crate]].sort()).toEqual(contractEvents(crate).sort());
  });
});

describe('parseEventLog', () => {
  it('parses an EVENT_JSON line', () => {
    const log =
      'EVENT_JSON:{"standard":"hairto","version":"1.0.0","event":"duel_voided","data":{"duel_id":7}}';
    expect(parseEventLog(log)).toEqual({
      standard: 'hairto',
      version: '1.0.0',
      event: 'duel_voided',
      data: { duel_id: 7 },
    });
  });

  it('ignores plain logs, broken JSON and incomplete events', () => {
    expect(parseEventLog('Transfer 5 from a to b')).toBeNull();
    expect(parseEventLog('EVENT_JSON:{')).toBeNull();
    expect(parseEventLog('EVENT_JSON:{"standard":"hairto"}')).toBeNull();
  });
});
