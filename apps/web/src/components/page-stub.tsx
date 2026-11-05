import type { ReactNode } from 'react';

/** Placeholder layout for pages whose features land in work package 6. */
export function PageStub({
  title,
  prdRef,
  badges,
  children,
}: {
  title: string;
  prdRef: string;
  badges?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {badges}
      </div>
      <p className="mt-1 font-mono text-xs text-white/40">{prdRef}</p>
      <div className="mt-6 space-y-3 text-white/70">{children}</div>
    </main>
  );
}
