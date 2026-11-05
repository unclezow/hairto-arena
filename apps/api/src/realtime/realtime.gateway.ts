import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { WS_EVENTS } from '@hairto-arena/shared';
import type { Redis } from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { SessionService, type Session } from '../auth/session.service.js';
import type { Env } from '../config/env.js';
import { RedisService } from '../redis/redis.service.js';
import { CHANNELS, ROOMS } from './channels.js';
import { DuelLiveStore } from './duel-live.js';
import { sanitizeEvent } from './events.js';
import { SnapshotService } from './snapshot.service.js';

type Ack = { ok: true } | { ok: false; error: { code: string; message: string } };

const fail = (code: string, message: string): Ack => ({ ok: false, error: { code, message } });
const ok: Ack = { ok: true };

/** The snapshot is rebuilt at most this many times if events arrive while it is being sent. */
const MAX_SNAPSHOT_ATTEMPTS = 3;

interface TickSlot {
  lastAt: number;
  pending?: unknown;
  timer?: NodeJS.Timeout;
}

/**
 * Pushes price ticks, oracle health and duel events to clients. Publishers (price service, duel event
 * publisher) write to Redis; every API instance relays each message to its own sockets only. Everything leaving
 * here passes `sanitizeEvent`, so no publisher can leak a hidden direction or seed by mistake.
 */
@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly connectionsPerIp = new Map<string, number>();
  private readonly tickSlots = new Map<string, TickSlot>();
  private subscriber?: Redis;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly snapshots: SnapshotService,
    private readonly live: DuelLiveStore,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---- connection ---------------------------------------------------------------------------------------------

  /** Handshake: reject a bad token and too many connections from one address. No token means anonymous. */
  afterInit(server: Server) {
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (err: Error) => next(err),
      );
    });
  }

  private async authenticate(socket: Socket): Promise<void> {
    const ip = this.clientIp(socket);
    if (
      (this.connectionsPerIp.get(ip) ?? 0) >=
      this.config.get('WS_MAX_CONNECTIONS_PER_IP', { infer: true })
    ) {
      throw new Error('RATE_LIMITED');
    }
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (token === undefined || token === null || token === '') return;

    const session =
      typeof token === 'string' ? await this.sessions.get(token).catch(() => null) : null;
    if (!session) throw new Error('UNAUTHENTICATED');
    socket.data.user = { accountId: session.accountId, role: session.role } satisfies Pick<
      Session,
      'accountId' | 'role'
    >;
  }

  /** Behind `TRUST_PROXY` proxies the address is the one the outermost trusted proxy saw, as Express does for HTTP. */
  private clientIp(socket: Socket): string {
    const hops = this.config.get('TRUST_PROXY', { infer: true });
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (hops > 0 && typeof forwarded === 'string') {
      const chain = forwarded.split(',').map((a) => a.trim());
      return chain[Math.max(0, chain.length - hops)] ?? socket.handshake.address;
    }
    return socket.handshake.address;
  }

  handleConnection(client: Socket) {
    const ip = this.clientIp(client);
    this.connectionsPerIp.set(ip, (this.connectionsPerIp.get(ip) ?? 0) + 1);
  }

  handleDisconnect(client: Socket) {
    const ip = this.clientIp(client);
    const left = (this.connectionsPerIp.get(ip) ?? 1) - 1;
    if (left <= 0) this.connectionsPerIp.delete(ip);
    else this.connectionsPerIp.set(ip, left);
  }

  // ---- relay from Redis ---------------------------------------------------------------------------------------

  async onModuleInit() {
    this.subscriber = this.redis.createSubscriber();
    this.subscriber.on('pmessage', (_pattern, channel, message) => this.relay(channel, message));
    try {
      await this.subscriber.psubscribe(
        CHANNELS.duelPattern,
        CHANNELS.pricePattern,
        CHANNELS.seasonPattern,
      );
    } catch (err) {
      this.logger.warn(`Redis unavailable, realtime relay disabled: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    for (const slot of this.tickSlots.values()) if (slot.timer) clearTimeout(slot.timer);
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Channel and room names are identical by design; the payload carries `{ event, data }`. */
  private relay(channel: string, message: string) {
    let parsed: { event?: unknown; data?: unknown };
    try {
      parsed = JSON.parse(message) as { event?: unknown; data?: unknown };
    } catch {
      this.logger.warn(`Dropped malformed message on ${channel}`);
      return;
    }
    if (typeof parsed.event !== 'string') {
      this.logger.warn(`Dropped a message without an event on ${channel}`);
      return;
    }

    const clean = sanitizeEvent(parsed.event, parsed.data);
    if (!clean.ok) {
      this.logger.warn(`Dropped ${parsed.event} on ${channel}: ${clean.reason}`);
      return;
    }
    if (clean.dropped.length > 0) {
      this.logger.warn(
        `${parsed.event} on ${channel} carried fields that may not be sent: ${clean.dropped.join(', ')}`,
      );
    }

    if (parsed.event === WS_EVENTS.tick) this.emitTick(channel, clean.data);
    else this.emitLocal(channel, parsed.event, clean.data);
  }

  /** `local`: every API instance receives the Redis message itself, so a cluster wide emit would duplicate it. */
  private emitLocal(room: string, event: string, data: unknown) {
    this.server.local.to(room).emit(event, data);
  }

  /** A burst of ticks reaches clients as at most one per interval; the newest always wins and is never lost. */
  private emitTick(room: string, data: unknown) {
    const minInterval = this.config.get('WS_TICK_MIN_INTERVAL_MS', { infer: true });
    const slot = this.tickSlots.get(room) ?? { lastAt: 0 };
    this.tickSlots.set(room, slot);

    const now = Date.now();
    if (now - slot.lastAt >= minInterval) {
      slot.lastAt = now;
      this.emitLocal(room, WS_EVENTS.tick, data);
      return;
    }
    slot.pending = data;
    slot.timer ??= setTimeout(
      () => {
        slot.timer = undefined;
        slot.lastAt = Date.now();
        const pending = slot.pending;
        slot.pending = undefined;
        if (pending !== undefined) this.emitLocal(room, WS_EVENTS.tick, pending);
      },
      minInterval - (now - slot.lastAt),
    );
  }

  // ---- rooms --------------------------------------------------------------------------------------------------

  @SubscribeMessage(WS_EVENTS.joinPrice)
  joinPrice(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.joinPublic(client, payload, ROOMS.price);
  }

  @SubscribeMessage(WS_EVENTS.leavePrice)
  async leavePrice(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.leave(client, payload, ROOMS.price);
  }

  @SubscribeMessage(WS_EVENTS.joinSeason)
  joinSeason(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.joinPublic(client, payload, ROOMS.season);
  }

  @SubscribeMessage(WS_EVENTS.leaveSeason)
  async leaveSeason(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.leave(client, payload, ROOMS.season);
  }

  @SubscribeMessage(WS_EVENTS.joinDuel)
  async joinDuel(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown): Promise<Ack> {
    const duelId = parseId(payload);
    if (duelId === null) return fail('VALIDATION_FAILED', 'Invalid duel id');
    const user = client.data.user as Pick<Session, 'accountId'> | undefined;
    if (!user) return fail('UNAUTHENTICATED', 'Sign in to watch your duel');
    const full = this.roomLimit(client);
    if (full) return full;

    let built = await this.snapshots.build(duelId);
    if (!built) return fail('NOT_FOUND', 'Duel not found');

    if (user.accountId !== built.access.fighter)
      return fail('FORBIDDEN', 'Only the fighter who played this duel may access it');

    // Snapshot first, then the room, then check nothing slipped in between; if it did, send a newer snapshot.
    for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt++) {
      this.sendSnapshot(client, built.snapshot);
      await client.join(ROOMS.duel(duelId));
      if ((await this.live.currentSeq(duelId)) <= built.snapshot.seq) break;
      const newer = await this.snapshots.build(duelId);
      if (!newer) break;
      if (user.accountId !== newer.access.fighter) {
        await client.leave(ROOMS.duel(duelId));
        return fail('FORBIDDEN', 'Only the fighter who played this duel may access it');
      }
      built = newer;
    }
    return ok;
  }

  @SubscribeMessage(WS_EVENTS.leaveDuel)
  async leaveDuel(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.leave(client, payload, ROOMS.duel);
  }

  private sendSnapshot(client: Socket, snapshot: unknown) {
    const clean = sanitizeEvent(WS_EVENTS.duelSnapshot, snapshot);
    if (clean.ok) client.emit(WS_EVENTS.duelSnapshot, clean.data);
  }

  private async joinPublic(
    client: Socket,
    payload: unknown,
    room: (id: never) => string,
  ): Promise<Ack> {
    const id = parseNumber(payload);
    if (id === null) return fail('VALIDATION_FAILED', 'Invalid id');
    const full = this.roomLimit(client);
    if (full) return full;
    await client.join((room as (id: number) => string)(id));
    return ok;
  }

  private async leave(client: Socket, payload: unknown, room: (id: never) => string): Promise<Ack> {
    const raw = typeof payload === 'string' || typeof payload === 'number' ? String(payload) : null;
    if (raw === null || !/^\d{1,30}$/.test(raw)) return fail('VALIDATION_FAILED', 'Invalid id');
    await client.leave((room as (id: string) => string)(raw));
    return ok;
  }

  private roomLimit(client: Socket): Ack | null {
    // Every socket is in a room named after its own id.
    const joined = client.rooms.size - 1;
    return joined >= this.config.get('WS_MAX_ROOMS_PER_SOCKET', { infer: true })
      ? fail('RATE_LIMITED', 'Too many rooms')
      : null;
  }
}

function parseId(payload: unknown): string | null {
  const raw = typeof payload === 'string' || typeof payload === 'number' ? String(payload) : null;
  return raw !== null && /^\d{1,30}$/.test(raw) ? raw : null;
}

function parseNumber(payload: unknown): number | null {
  const id = parseId(payload);
  return id === null ? null : Number(id);
}
