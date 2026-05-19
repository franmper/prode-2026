// Mirror of public.match_points() in db/schema.sql.
// Keep both in sync: exact score = 3, correct result = 1, otherwise 0.

export function matchPoints(
  predictedHome: number | null,
  predictedAway: number | null,
  actualHome: number | null,
  actualAway: number | null,
): number {
  if (
    predictedHome == null ||
    predictedAway == null ||
    actualHome == null ||
    actualAway == null
  ) {
    return 0;
  }
  if (predictedHome === actualHome && predictedAway === actualAway) return 3;
  if (Math.sign(predictedHome - predictedAway) === Math.sign(actualHome - actualAway)) {
    return 1;
  }
  return 0;
}

export function isLocked(kickoffAt: string, status: string): boolean {
  return status !== 'scheduled' || new Date(kickoffAt).getTime() <= Date.now();
}

export function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
