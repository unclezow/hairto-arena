import { ClaimList } from '@/components/mvp/claim-list';
import { WalletBar } from '@/components/mvp/wallet-bar';

export const metadata = { title: 'Claim · Hairto Arena' };

export default function Claim() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">Claim</h1>
      <p className="text-sm text-white/60">
        Fighter prizes and Backer bonuses of the connected wallet, once a season&apos;s results are
        final.
      </p>
      <WalletBar />
      <ClaimList />
    </main>
  );
}
