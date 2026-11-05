import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/play/lobby?panel=leaderboard');
}
