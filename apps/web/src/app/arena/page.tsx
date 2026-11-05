import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ArenaPreview } from '@/components/arena/arena-preview';

export const metadata: Metadata = {
  title: 'The Proving Grounds — Hairto Arena',
  description: 'Two fighters. Two floating islands. Explore the Hairto Arena 3D arena.',
};

export default function ArenaPage() {
  // `useSearchParams` (the live duel id) needs a boundary; it renders no element of its own.
  return (
    <Suspense fallback={null}>
      <ArenaPreview />
    </Suspense>
  );
}
