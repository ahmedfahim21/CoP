import { track as vercelTrack } from '@vercel/analytics';

/**
 * Gameplay events for Vercel Web Analytics (custom events need a Pro plan; on Hobby they're
 * dropped quietly). Names and properties are kept small and free of personal data: no
 * names, tags or credentials, only what kind of thing happened.
 */
export type GameEvent =
  /** A battle began. */
  | { name: 'battle_start'; mode: string }
  /** A battle ended; `outcome` from the player's side. */
  | { name: 'battle_end'; mode: string; outcome: 'win' | 'loss' | 'draw' }
  /** How a ranked search ended. */
  | { name: 'queue_result'; result: 'ranked' | 'ghost' | 'training' | 'cancelled'; waited: number }
  /** The very first battle a trainer finishes. */
  | { name: 'first_battle' }
  | { name: 'league_clear'; stage: string; stars: number }
  | { name: 'level_up'; level: number }
  | { name: 'quest_complete'; quest: string }
  | { name: 'puzzle_solved'; puzzle: string }
  | { name: 'replay_watched' };

export function track(event: GameEvent) {
  const { name, ...props } = event;
  try {
    vercelTrack(name, props);
  } catch (err) {
    // Analytics must never break the game.
    console.warn('Analytics event failed', err);
  }
}
