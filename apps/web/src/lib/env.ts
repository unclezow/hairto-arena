/** Public values inlined by Next.js. Private keys never belong in this module. */
export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3001',
  network: process.env.NEXT_PUBLIC_NEAR_NETWORK ?? 'testnet',
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '',
  privyClientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID ?? '',
  appOrigin: process.env.NEXT_PUBLIC_APP_ORIGIN ?? '',
} as const;
