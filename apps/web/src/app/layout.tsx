import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import { Nav } from '@/components/nav';
import { Providers } from './providers';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Hairto Arena',
  description:
    'Trading duels on real-world asset prices, funded by yield. Your deposit stays safe.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers>
          <Suspense fallback={null}>
            <Nav />
          </Suspense>
          {children}
        </Providers>
      </body>
    </html>
  );
}
