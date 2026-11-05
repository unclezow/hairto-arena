import type { Metadata } from 'next';
import { TitleScreen } from '@/components/title-screen';

export const metadata: Metadata = {
  title: 'Hairto Arena — Trade. Battle. Rise.',
  description:
    '30-second paper trading duels on real market prices. Learn how to play, protect your principal, and compete for season rewards on NEAR testnet.',
};

export default function Landing() {
  return <TitleScreen />;
}
