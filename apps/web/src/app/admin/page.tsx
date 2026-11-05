import { AdminPanel } from '@/components/mvp/admin-panel';

export const metadata = { title: 'Admin · Hairto Arena' };

export default function Admin() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <AdminPanel />
    </main>
  );
}
