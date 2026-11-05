import { io, type Socket } from 'socket.io-client';
import { env } from './env';
import { getSessionToken } from './session';

let socket: Socket | undefined;

/** Shared Socket.IO connection to the realtime gateway (quotes, HP, duel results). Sends the session token. */
export function getSocket(): Socket {
  socket ??= io(env.wsUrl, {
    autoConnect: false,
    transports: ['websocket'],
    auth: (cb) => cb(getSessionToken() ? { token: getSessionToken() } : {}),
  });
  return socket;
}
