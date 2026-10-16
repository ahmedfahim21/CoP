import express, { type NextFunction, type Request, type Response } from 'express';
import { logger, matchMaker } from 'colyseus';
import {
  QUEUE_ROOM_NAME, ROOM_NAME, applyPuzzle, dayKey, isProfileTag, puzzleById, seasonKey,
  type CreatedProfileResponse, type LeaderboardResponse, type OwnProfileResponse, type ProfileResponse, type ProfileUpdate,
  type ScoreboardResponse, type StatusResponse,
} from '@cop/shared';
import type { ProfileStore } from './store.js';

/** Profile creations allowed per address per window, so nobody can flood the ladder. */
export const CREATE_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 };

/**
 * /api: profiles, the ladder and match history. The owner authenticates with
 * `Authorization: Bearer <credential>`; everything else is public.
 */
export function apiRouter(store: ProfileStore): express.Router {
  const router = express.Router();
  const creations = new Map<string, number[]>();

  router.use((req, res, next) => {
    // The game client is served from another origin (Vite on :5173).
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Cache-Control': 'no-store',
    });
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  router.use(express.json({ limit: '4kb' }));

  router.post('/profiles', async (req, res) => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const recent = (creations.get(ip) ?? []).filter((t) => now - t < CREATE_LIMIT.windowMs);
    if (recent.length >= CREATE_LIMIT.max) {
      res.status(429).json({ error: 'Too many new profiles from this address; try again later' });
      return;
    }
    creations.set(ip, [...recent, now]);
    const body = (req.body ?? {}) as { name?: unknown };
    const { profile, credential } = await store.create(body.name);
    logger.info(`[api] created profile ${profile.id} (${profile.name})`);
    res.status(201).json({ profile, credential } satisfies CreatedProfileResponse);
  });

  router.get('/profiles/me', async (req, res) => {
    const me = await authenticate(store, req, res);
    if (!me) return;
    res.json({ profile: me, matches: await store.recentMatches(me.id) } satisfies OwnProfileResponse);
  });

  router.patch('/profiles/me', async (req, res) => {
    const me = await authenticate(store, req, res);
    if (!me) return;
    const body = (req.body ?? {}) as ProfileUpdate;
    const { profile, rejected } = await store.update(me.id, { name: body.name, deck: body.deck, starters: body.starters });
    if (rejected.length > 0) {
      res.status(400).json({ error: `Invalid ${rejected.join(' and ')}` });
      return;
    }
    res.json({ profile: profile!, matches: await store.recentMatches(me.id) } satisfies OwnProfileResponse);
  });

  router.get('/profiles/:id', async (req, res) => {
    const id = String(req.params.id).toUpperCase();
    const profile = isProfileTag(id) ? await store.get(id) : null;
    if (!profile) {
      res.status(404).json({ error: 'No such trainer' });
      return;
    }
    res.json({ profile, matches: await store.recentMatches(id) } satisfies ProfileResponse);
  });

  router.get('/leaderboard', async (req, res) => {
    const limit = clampInt(req.query.limit, 1, 100, 50);
    const offset = clampInt(req.query.offset, 0, 1_000_000, 0);
    res.json((await store.leaderboard(limit, offset)) satisfies LeaderboardResponse);
  });

  router.get('/status', async (_req, res) => {
    const [battles, queues] = await Promise.all([matchMaker.query({ name: ROOM_NAME }), matchMaker.query({ name: QUEUE_ROOM_NAME })]);
    const inBattle = battles.reduce((sum, r) => sum + r.clients, 0);
    const searching = queues.reduce((sum, r) => sum + r.clients, 0);
    res.json({ online: inBattle + searching, inBattle, searching } satisfies StatusResponse);
  });

  router.get('/scores/:board', async (req, res) => {
    const board = String(req.params.board);
    if (board !== 'daily' && board !== 'gauntlet') {
      res.status(404).json({ error: 'No such board' });
      return;
    }
    const now = Date.now();
    const raw = typeof req.query.period === 'string' ? req.query.period : '';
    const valid = board === 'daily' ? /^\d{4}-\d{2}-\d{2}$/.test(raw) : /^\d{4}-\d{2}$/.test(raw);
    const period = valid ? raw : board === 'daily' ? dayKey(now) : seasonKey(now);
    res.json((await store.scoreboard(board, period, clampInt(req.query.limit, 1, 100, 50))) satisfies ScoreboardResponse);
  });

  router.get('/replays/:id', async (req, res) => {
    const id = Number.parseInt(String(req.params.id), 10);
    const replay = Number.isSafeInteger(id) && id > 0 ? await store.replay(id) : null;
    if (!replay) {
      res.status(404).json({ error: 'No replay for that battle' });
      return;
    }
    // Replays never change once stored.
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(replay);
  });

  /** Puzzles run in the browser; solving one is claimed here, once per puzzle. */
  router.post('/progress/puzzle', async (req, res) => {
    const me = await authenticate(store, req, res);
    if (!me) return;
    const puzzle = puzzleById((req.body as { id?: unknown } | undefined)?.id);
    if (!puzzle) {
      res.status(400).json({ error: 'No such puzzle' });
      return;
    }
    const r = await store.updateProgress(me.id, (p) => {
      const out = applyPuzzle(p, puzzle.id);
      return { progress: out.progress, result: out };
    });
    const profile = await store.own(me.id);
    res.json({ xp: r?.xp ?? 0, unlocked: r?.unlocked ?? [], levelBefore: r?.levelBefore, levelAfter: r?.levelAfter, profile });
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof err === 'object' && err !== null && 'status' in err ? Number(err.status) : 500;
    if (status >= 500) logger.error('[api] request failed:', err);
    res.status(status).json({ error: status >= 500 ? 'Server error' : 'Bad request' });
  });

  return router;
}

async function authenticate(store: ProfileStore, req: Request, res: Response) {
  const header = req.get('authorization') ?? '';
  const credential = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  const me = credential ? await store.authenticate(credential) : null;
  if (!me) res.status(401).json({ error: 'Profile not recognised' });
  return me;
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
