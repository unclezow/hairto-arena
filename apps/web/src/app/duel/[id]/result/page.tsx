import { Suspense } from 'react';
import { DuelResult } from '@/components/play/duel-result';

export default function DuelResultPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="hub-loading">Counting the score…</div>}>
      <DuelResultLoader params={params} />
    </Suspense>
  );
}

async function DuelResultLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DuelResult id={id} />;
}
