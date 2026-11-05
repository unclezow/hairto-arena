import { Suspense } from 'react';
import { PlayHub } from '@/components/play/play-hub';
import LeaderboardContent from '@/components/play/leaderboard-content';
import StoreContent from '@/components/play/store-content';
import HistoryContent from '@/components/play/history-content';

export default function PlayLobby() {
  return (
    <Suspense fallback={<div className="hub-loading">Preparing your quarters…</div>}>
      <PlayHub
        leaderboard={<LeaderboardContent />}
        store={<StoreContent />}
        history={<HistoryContent />}
      />
    </Suspense>
  );
}
