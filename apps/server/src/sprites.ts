import type { Request, Response } from 'express';
import { logger } from 'colyseus';

/** Showdown's trainer sprites don't send CORS headers, so the game server relays them. */
export const TRAINER_SPRITE_NAMES = ['red', 'blue'] as const;
const upstream = (name: string) => `https://play.pokemonshowdown.com/sprites/trainers/${name}.png`;

export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export function trainerSpriteHandler(fetchFn: FetchFn) {
  const cache = new Map<string, Promise<Buffer>>();

  const load = (name: string) => {
    let pending = cache.get(name);
    if (!pending) {
      pending = fetchFn(upstream(name)).then(async (res) => {
        if (!res.ok) throw new Error(`upstream ${res.status} for ${name}`);
        return Buffer.from(await res.arrayBuffer());
      });
      // Don't cache failures; the next request retries.
      pending.catch(() => cache.delete(name));
      cache.set(name, pending);
    }
    return pending;
  };

  return async (req: Request, res: Response) => {
    const name = String(req.params.name);
    if (!(TRAINER_SPRITE_NAMES as readonly string[]).includes(name)) {
      res.status(404).json({ error: 'unknown trainer' });
      return;
    }
    try {
      const png = await load(name);
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
      res.send(png);
    } catch (err) {
      logger.error(`[sprites] trainer ${name} failed:`, err);
      res.status(502).json({ error: 'sprite upstream failed' });
    }
  };
}
