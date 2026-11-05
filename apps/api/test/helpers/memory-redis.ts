import type { RedisService } from '../../src/redis/redis.service.js';

/**
 * The few Redis commands the realtime relay uses (strings, lists, streams, publish, the leader lock's scripts),
 * in memory. Expiry is ignored.
 */
export class MemoryRedis {
  strings = new Map<string, string>();
  lists = new Map<string, string[]>();
  streams = new Map<string, [string, string[]][]>();
  published: { channel: string; payload: Record<string, unknown> }[] = [];

  readonly client = {
    get: async (k: string) => this.strings.get(k) ?? null,
    set: async (k: string, v: string, ...args: (string | number)[]) => {
      if (args.includes('NX') && this.strings.has(k)) return null;
      this.strings.set(k, v);
      return 'OK';
    },
    del: async (...keys: string[]) => keys.filter((k) => this.strings.delete(k)).length,
    incr: async (k: string) => {
      const next = Number(this.strings.get(k) ?? 0) + 1;
      this.strings.set(k, String(next));
      return next;
    },
    expire: async () => 1,
    eval: async (script: string, _n: number, key: string, id: string) => {
      if (this.strings.get(key) !== id) return 0;
      if (!script.includes('pexpire')) this.strings.delete(key);
      return 1;
    },
    rpush: async (k: string, ...values: string[]) => this.list(k).push(...values),
    lrange: async (k: string) => [...this.list(k)],
    multi: () => {
      const ops: (() => Promise<unknown>)[] = [];
      const chain = {
        rpush: (k: string, ...v: string[]) => (ops.push(() => this.client.rpush(k, ...v)), chain),
        expire: () => chain,
        exec: async () => {
          for (const op of ops) await op();
          return [];
        },
      };
      return chain;
    },
    xadd: async (k: string, ...args: (string | number)[]) => {
      // MAXLEN ~ <n> <id> <field> <value>
      const [, , , id, field, value] = args.map(String);
      const stream = this.streams.get(k) ?? [];
      stream.push([id!, [field!, value!]]);
      this.streams.set(k, stream);
      return id;
    },
    xrange: async (k: string, start: string, end: string) => {
      const n = (id: string) => BigInt(id.split('-')[0]!);
      return (this.streams.get(k) ?? []).filter(([id]) => n(id) >= n(start) && n(id) <= n(end));
    },
    publish: async (channel: string, message: string) => {
      this.published.push({ channel, payload: JSON.parse(message) as Record<string, unknown> });
      return 1;
    },
  };

  get service(): RedisService {
    return {
      client: this.client,
      publish: (channel: string, payload: unknown) =>
        this.client.publish(channel, JSON.stringify(payload)),
    } as unknown as RedisService;
  }

  private list(k: string) {
    const list = this.lists.get(k) ?? [];
    this.lists.set(k, list);
    return list;
  }
}
