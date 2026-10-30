export type Post = {
  id: string; platformId: string | null; text: string; createdAt: string;
  importedAt: string | null; firstSeen: string; lastSeen: string;
  type: string; url: string | null; raw: Record<string, unknown>;
}
export type Day = { date: string; count: number | null; observed: number; complete: boolean }
export type Tracking = {
  id: string; title: string; startDate: string; endDate: string;
  isActive: boolean; url: string | null; official: number | null;
  local: number; checkedAt: string | null; raw: Record<string, unknown>;
}
export type Status = {
  collectionMode?: 'local' | 'cloud';
  state: 'idle' | 'syncing' | 'error'; lastSuccess: string | null;
  lastAttempt: string | null; error: string | null; archived: number;
  sourceTotal: number | null; currentRecords: number; archiveDifference: number | null; historyVerifiedAt: string | null; earliest: string | null; sourceLastSync: string | null;
  backfillCursor: string | null; startedAt: string; coverageDays: number;
}
export type Dashboard = {
  status: Status; days: Day[]; trackings: Tracking[];
  hourly: { hour: number; count: number | null }[];
  types: { type: string; count: number }[];
  latest: Post[]; timezone: string; generatedAt: string;
}
