import { redirect } from 'next/navigation';

/** Connecting lives in the lobby's modal (PRD 12.1 Onboarding/Login). */
export default function Onboarding() {
  redirect('/play/lobby?connect=1');
}
