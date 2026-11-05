import { EconomyPanel } from '@/components/mvp/economy-panel';

export const metadata = { title: 'Economy · Hairto Arena' };

export default function Economy() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">Economy</h1>
      <p className="text-sm text-white/60">
        Where the money sits, how much yield it earns, and how a season of yield is shared between
        Fighters and Backers.
      </p>
      <EconomyPanel />
    </main>
  );
}
