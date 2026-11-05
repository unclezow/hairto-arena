import { BackerPanel } from '@/components/mvp/backer-panel';

export const metadata = { title: 'Backer · Hairto Arena' };

export default function Backer() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">Backer</h1>
      <BackerPanel />
    </main>
  );
}
