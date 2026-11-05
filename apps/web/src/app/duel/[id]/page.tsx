import { Suspense } from 'react';
import { DuelScreen } from './duel-screen';

// Params are awaited inside <Suspense> so Cache Components can prerender the static shell.
export default function DuelPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-white/50">Loading duel…</p>}>
      <DuelLoader params={params} />
    </Suspense>
  );
}

async function DuelLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DuelScreen duelId={id} />;
}
