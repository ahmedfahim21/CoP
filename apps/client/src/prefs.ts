import { DEFAULT_DECK, STARTER_IDS, isDeck, isStarterPick, sanitizeTrainerName, type CardId, type StarterPick } from '@cop/shared';

export interface Prefs {
  name: string;
  /** Whether the player has chosen their name (asked once, at the start). */
  named: boolean;
  starters: StarterPick;
  deck: CardId[];
}

const KEY = 'cop:prefs';
const DEFAULTS: Prefs = { name: 'Trainer', named: false, starters: ['charmander', 'squirtle'], deck: [...DEFAULT_DECK] };

/** Local conveniences only; a failed read just means defaults. */
export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null;
    const name = sanitizeTrainerName(raw?.name ?? DEFAULTS.name);
    return {
      name,
      // Prefs saved before this flag existed: a custom name means they already chose one.
      named: typeof raw?.named === 'boolean' ? raw.named : name !== DEFAULTS.name,
      starters: isStarterPick(raw?.starters) ? raw.starters : DEFAULTS.starters,
      deck: isDeck(raw?.deck) ? raw.deck : [...DEFAULTS.deck],
    };
  } catch (err) {
    console.warn('Could not read saved preferences', err);
    return { ...DEFAULTS, deck: [...DEFAULTS.deck] };
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch (err) {
    console.warn('Could not save preferences', err);
  }
}

export const ALL_STARTERS = STARTER_IDS;
