// Mirror of public.match_points() / match_outcome() in the SQL migrations.
// 1-X-2: correct outcome = 1 pt, wrong = 0.

import type { Outcome } from './types';

export function actualOutcome(
  home: number | null,
  away: number | null,
): Outcome | null {
  if (home == null || away == null) return null;
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'draw';
}

export function matchPoints(
  predicted: Outcome | null,
  home: number | null,
  away: number | null,
): number {
  const actual = actualOutcome(home, away);
  if (!predicted || actual == null) return 0;
  return predicted === actual ? 1 : 0;
}

export function isLocked(kickoffAt: string, status: string): boolean {
  return status !== 'scheduled' || new Date(kickoffAt).getTime() <= Date.now();
}

export function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
