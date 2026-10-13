import { searchWindow } from '@cop/shared';

export interface QueueEntry {
  profileId: string;
  trophies: number;
  /** ms timestamp. */
  joinedAt: number;
}

/**
 * Pairs queued players. Longest-waiting players choose first; each takes the closest
 * trophy count within the pair's search window (the average of both players' windows,
 * which widen the longer they wait). Among candidates in range, a fresh opponent beats a
 * rematch of the previous battle, and anyone beats playing your own profile (two tabs on
 * one device), which is allowed only as a last resort and never rated.
 */
export function pairUp<T extends QueueEntry>(entries: readonly T[], now: number, lastOpponent: (profileId: string) => string | undefined = () => undefined): Array<[T, T]> {
  const waiting = [...entries].sort((a, b) => a.joinedAt - b.joinedAt);
  const taken = new Set<T>();
  const pairs: Array<[T, T]> = [];
  for (const a of waiting) {
    if (taken.has(a)) continue;
    let best: { b: T; key: [number, number, number] } | null = null;
    for (const b of waiting) {
      if (b === a || taken.has(b)) continue;
      const gap = Math.abs(a.trophies - b.trophies);
      if (gap > allowedGap(a, b, now)) continue;
      const tier = b.profileId === a.profileId ? 2 : lastOpponent(a.profileId) === b.profileId ? 1 : 0;
      const key: [number, number, number] = [tier, gap, b.joinedAt];
      if (!best || compare(key, best.key) < 0) best = { b, key };
    }
    if (!best) continue;
    taken.add(a).add(best.b);
    pairs.push([a, best.b]);
  }
  return pairs;
}

export function allowedGap(a: QueueEntry, b: QueueEntry, now: number): number {
  const wa = searchWindow((now - a.joinedAt) / 1000);
  const wb = searchWindow((now - b.joinedAt) / 1000);
  return (wa + wb) / 2;
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
