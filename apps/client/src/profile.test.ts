import { DEFAULT_DECK, type OwnProfile, type OwnProfileResponse } from '@cop/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A browser-ish world for prefs/profile: localStorage and window timers.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal('window', globalThis);

// The real api module reads the page's location; the session only needs these three calls.
const { api, ApiError } = vi.hoisted(() => ({
  api: { createProfile: vi.fn(), me: vi.fn(), updateMe: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock('./api.js', () => ({ api, ApiError }));

const { loadPrefs } = await import('./prefs.js');
const { ProfileSession } = await import('./profile.js');

const CREDENTIAL = 'PYLQ0289.abcdefghijklmnopqrstuvwxyz012345';
const profile = (over: Partial<OwnProfile> = {}): OwnProfile => ({
  id: 'PYLQ0289', name: 'Trainer', createdAt: 0, rank: null, trophies: 0, bestTrophies: 0, wins: 0, losses: 0, draws: 0,
  threeCrowns: 0, streak: 0, bestStreak: 0, battles: 0, deck: [...DEFAULT_DECK], starters: ['charmander', 'squirtle'], ...over,
});
const res = (p: OwnProfile): OwnProfileResponse => ({ profile: p, matches: [] });
/** The name the server ends up with: echo whatever updateMe was sent. */
const echoUpdates = (base: OwnProfile) =>
  api.updateMe.mockImplementation(async (_c: string, u: Partial<OwnProfile>) => res({ ...base, ...Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)) }));

beforeEach(() => {
  store.clear();
  vi.useFakeTimers();
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('who is asked for a name', () => {
  it('a brand-new player is', () => {
    expect(loadPrefs()).toMatchObject({ name: 'Trainer', named: false });
  });

  it('prefs from before the flag: a custom name counts as chosen, the default does not', () => {
    store.set('cop:prefs', JSON.stringify({ name: 'Misty' }));
    expect(loadPrefs()).toMatchObject({ name: 'Misty', named: true });
    store.set('cop:prefs', JSON.stringify({ name: 'Trainer' }));
    expect(loadPrefs()).toMatchObject({ name: 'Trainer', named: false });
  });

  it('an explicit flag is respected either way', () => {
    store.set('cop:prefs', JSON.stringify({ name: 'Trainer', named: true }));
    expect(loadPrefs().named).toBe(true);
    store.set('cop:prefs', JSON.stringify({ name: 'Brock', named: false }));
    expect(loadPrefs().named).toBe(false);
  });
});

describe('choosing a name', () => {
  it('creates a new player\'s profile with that name, in one go', async () => {
    api.createProfile.mockResolvedValue({ profile: profile({ name: 'Ash' }), credential: CREDENTIAL });
    echoUpdates(profile({ name: 'Ash' }));
    const prefs = loadPrefs();
    const session = new ProfileSession(prefs);
    session.chooseName('  Ash  ');
    await session.connect();
    await vi.runAllTimersAsync();

    expect(api.createProfile).toHaveBeenCalledWith('Ash');
    // Only the deck and towers follow; no rename round trip.
    expect(api.updateMe).toHaveBeenCalledTimes(1);
    expect(api.updateMe.mock.calls[0]![1]).not.toHaveProperty('name');
    expect(prefs).toMatchObject({ name: 'Ash', named: true });
    expect(JSON.parse(store.get('cop:prefs')!)).toMatchObject({ name: 'Ash', named: true });
  });

  it('wins over the server\'s old name for a returning player, and is pushed to it', async () => {
    store.set('cop:credential', CREDENTIAL);
    api.me.mockResolvedValue(res(profile({ name: 'Trainer', trophies: 120 })));
    echoUpdates(profile({ name: 'Trainer', trophies: 120 }));
    const prefs = loadPrefs();
    const session = new ProfileSession(prefs);
    session.chooseName('Misty');
    await session.connect();
    expect(prefs.name).toBe('Misty');
    await vi.runAllTimersAsync();

    expect(api.updateMe).toHaveBeenCalledTimes(1);
    expect(api.updateMe.mock.calls[0]![1]).toMatchObject({ name: 'Misty' });
    expect(session.profile).toMatchObject({ name: 'Misty', trophies: 120 });
  });

  it('a returning player who doesn\'t choose keeps the server\'s name, with nothing pushed', async () => {
    store.set('cop:credential', CREDENTIAL);
    api.me.mockResolvedValue(res(profile({ name: 'Gary' })));
    const prefs = loadPrefs();
    const session = new ProfileSession(prefs);
    await session.connect();
    await vi.runAllTimersAsync();
    expect(prefs.name).toBe('Gary');
    expect(api.updateMe).not.toHaveBeenCalled();
  });

  it('an empty choice falls back to the default name', () => {
    const prefs = loadPrefs();
    new ProfileSession(prefs).chooseName('   ');
    expect(prefs).toMatchObject({ name: 'Trainer', named: true });
  });
});
