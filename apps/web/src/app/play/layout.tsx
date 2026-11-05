import type { ReactNode } from 'react';
import { PlayShell } from '@/components/play/play-shell';

export default function PlayLayout({ children }: { children: ReactNode }) {
  return <PlayShell>{children}</PlayShell>;
}
