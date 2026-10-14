// Smoke test for a deployed game server: HTTP health and API, then a real training battle over
// WebSockets as a guest (guests are never recorded, so this writes nothing to the database).
//   pnpm smoke https://api.example.com   (from the repo root)
import { Client } from '@colyseus/sdk';
import { DEFAULT_DECK, ROOM_NAME } from '@cop/shared';
import { BattleState } from '@cop/shared/schema';

const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) throw new Error('Usage: pnpm smoke https://your-game-server');

const step = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  const out = await fn();
  console.log(`✓ ${label} (${Math.round(performance.now() - t0)} ms)`);
  return out;
};

await step('GET /health', async () => {
  const res = await fetch(`${base}/health`);
  const body = await res.json() as { ok?: boolean };
  if (!res.ok || body.ok !== true) throw new Error(`/health answered ${res.status} ${JSON.stringify(body)}`);
});

await step('GET /api/leaderboard (reaches Supabase)', async () => {
  const res = await fetch(`${base}/api/leaderboard`);
  if (!res.ok) throw new Error(`/api/leaderboard answered ${res.status}: ${await res.text()}`);
  const body = await res.json() as { total?: unknown };
  if (typeof body.total !== 'number') throw new Error(`unexpected leaderboard body ${JSON.stringify(body)}`);
});

const room = await step('join a training battle over WebSockets', () =>
  new Client(base).create(ROOM_NAME, { starters: ['charmander', 'squirtle'], name: 'Smoke test', deck: [...DEFAULT_DECK], training: true }, BattleState));

// The hand of cards is private to us; the smoke test has no use for it.
room.onMessage('hand', () => undefined);

await step('receive the synced battle state', () => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('no battle state within 10s')), 10_000);
  const check = () => {
    if (room.state.entities.size >= 6) {
      clearTimeout(timer);
      resolve();
    }
  };
  room.onStateChange(check);
  check();
}));

await room.leave();
console.log(`\nAll good: ${base} serves HTTP, the API and live battles.`);
