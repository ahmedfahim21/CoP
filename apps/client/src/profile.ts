import { parseCredential, sanitizeTrainerName, type MatchRecord, type OwnProfile, type OwnProfileResponse } from '@cop/shared';
import { ApiError, api } from './api.js';
import { savePrefs, type Prefs } from './prefs.js';

const KEY = 'cop:credential';
const SYNC_DELAY_MS = 600;

export type ProfileStatus = 'loading' | 'ready' | 'offline';

/**
 * The player's server profile. The credential lives in localStorage; the profile itself
 * (name, trophies, deck, towers, history) lives on the server, so it survives cleared
 * caches only if the player kept their restore code, and follows them to any device that
 * enters it. Local prefs stay the source of truth for the loadout while offline.
 */
export class ProfileSession {
  status: ProfileStatus = 'loading';
  profile: OwnProfile | null = null;
  matches: MatchRecord[] = [];
  /** Why the last attempt to reach the server failed, for the UI. */
  problem: string | null = null;
  private credential: string | null = readCredential();
  private readonly listeners = new Set<() => void>();
  private syncTimer = 0;
  private loading: Promise<void> | null = null;
  /** A name just chosen here that the server may not have yet. */
  private chosenName: string | null = null;

  constructor(private readonly prefs: Prefs) {}

  get restoreCode(): string | null {
    return this.credential;
  }

  /** Credential for joining rooms, once the profile is known to be valid. */
  get activeCredential(): string | null {
    return this.status === 'ready' ? this.credential : null;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Load the profile, creating one on first run. Safe to call repeatedly. */
  connect(): Promise<void> {
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  /** Re-fetch after a battle so trophies and history are current. */
  async refresh(): Promise<void> {
    if (!this.credential || this.status !== 'ready') return this.connect();
    try {
      this.apply(await api.me(this.credential), false);
    } catch (err) {
      console.warn('Refreshing the profile failed', err);
    }
  }

  /**
   * Set the trainer's name, chosen on this device, and sync it. If the profile hasn't loaded
   * yet, the choice wins over the server's copy when it does.
   */
  chooseName(raw: string) {
    this.prefs.name = sanitizeTrainerName(raw);
    this.prefs.named = true;
    if (this.status === 'ready') {
      this.saveLoadout();
      return;
    }
    // Not loaded yet: keep it locally; creating or loading the profile settles it with the server.
    this.chosenName = this.prefs.name;
    savePrefs(this.prefs);
  }

  /** Push the local loadout (name, deck, towers) to the server, debounced. */
  saveLoadout() {
    savePrefs(this.prefs);
    clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => void this.pushLoadout(), SYNC_DELAY_MS);
  }

  /** Switch to the profile behind a restore code from another device. */
  async restore(code: string): Promise<void> {
    const credential = code.trim();
    if (!parseCredential(credential)) throw new ApiError(400, "That isn't a restore code");
    const res = await api.me(credential);
    this.credential = credential;
    writeCredential(credential);
    this.apply(res, true);
  }

  private async load() {
    this.status = 'loading';
    this.emit();
    try {
      if (this.credential) {
        try {
          this.apply(await api.me(this.credential), true);
          return;
        } catch (err) {
          // The server no longer knows this profile (e.g. its database was reset): start over.
          if (!(err instanceof ApiError) || err.status !== 401) throw err;
          console.warn('Saved profile was not recognised; creating a new one');
        }
      }
      const created = await api.createProfile(this.prefs.name);
      this.credential = created.credential;
      writeCredential(created.credential);
      // A brand-new profile adopts whatever deck and towers this device already had.
      this.apply(await api.updateMe(created.credential, { deck: this.prefs.deck, starters: this.prefs.starters }), true);
    } catch (err) {
      console.error('Loading the trainer profile failed', err);
      this.status = 'offline';
      this.problem = err instanceof Error ? err.message : String(err);
      this.emit();
    }
  }

  private async pushLoadout() {
    if (!this.credential || this.status !== 'ready') return;
    try {
      this.apply(await api.updateMe(this.credential, { name: this.prefs.name, deck: this.prefs.deck, starters: this.prefs.starters }), false);
    } catch (err) {
      console.error('Saving the loadout to the server failed', err);
    }
  }

  /** `adoptLoadout` copies the server's name, deck and towers into local prefs. */
  private apply(res: OwnProfileResponse, adoptLoadout: boolean) {
    this.profile = res.profile;
    this.matches = res.matches;
    this.status = 'ready';
    this.problem = null;
    if (adoptLoadout) {
      this.prefs.name = this.chosenName ?? res.profile.name;
      this.prefs.deck = [...res.profile.deck];
      this.prefs.starters = res.profile.starters;
      savePrefs(this.prefs);
    }
    // A name chosen before the profile loaded: send it now if the server still has the old one.
    if (this.chosenName !== null) {
      const stale = res.profile.name !== this.chosenName;
      this.chosenName = null;
      if (stale) this.saveLoadout();
    }
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

function readCredential(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return parseCredential(v) ? v : null;
  } catch (err) {
    console.warn('Could not read the saved profile', err);
    return null;
  }
}

function writeCredential(credential: string) {
  try {
    localStorage.setItem(KEY, credential);
  } catch (err) {
    console.warn('Could not save the profile credential', err);
  }
}
