import type { PokeType } from '@cop/shared';
import {
  BirdIcon, BoxingGlove01Icon, Brain01Icon, Bug01Icon, CastleIcon, Copy01Icon, CrosshairIcon, CrownIcon, Dumbbell01Icon,
  FavouriteIcon, FeatherIcon, FireIcon, FootprintsIcon, GhostIcon, Hexagon01Icon, Key01Icon, Layers01Icon, Leaf01Icon,
  Medal01Icon, Moon02Icon, MountainIcon, PencilEdit01Icon, RefreshIcon, Robot01Icon, Shield01Icon, ShovelIcon,
  SnowIcon, SparklesIcon, StoneIcon, SwordsIcon, Target01Icon, Timer01Icon, TrophyIcon, UserGroupIcon, UserIcon,
  ZapIcon, DropletIcon, ArrowUp02Icon, VolumeHighIcon, VolumeOffIcon, BiohazardIcon, Alert01Icon, Tick02Icon, InformationCircleIcon,
  StarIcon, SquareLock02Icon, PlayIcon, PauseIcon, Share08Icon, PuzzleIcon, Calendar03Icon, Route01Icon, Forward01Icon,
  RotateLeft01Icon, Award01Icon, Flag01Icon, VideoReplayIcon, MapsIcon, GiftIcon,
} from '@hugeicons/core-free-icons';

/**
 * Icons: Hugeicons stroke-rounded (hugeicons.com, MIT), plus a few game-specific ones drawn
 * here on the same 24px grid with the same 1.5 rounded stroke so they sit in the same set.
 */
/** Hugeicons' data shape: a list of [tag, attributes]. */
export type IconData = readonly (readonly [string, Readonly<Record<string, string | number>>])[];

const line = (d: string): [string, Record<string, string>] => ['path', { d }];
const circle = (cx: number, cy: number, r: number): [string, Record<string, string | number>] => ['circle', { cx, cy, r }];

/** Poké Ball: the game's own mark. */
export const PokeBallIcon: IconData = [
  circle(12, 12, 9.25),
  line('M2.75 12H8.75M15.25 12H21.25'),
  circle(12, 12, 3.25),
];

/** Elixir drop. */
export const ElixirIcon: IconData = [
  line('M12 2.75C12 2.75 5.25 9.4 5.25 14.25C5.25 17.98 8.27 21.25 12 21.25C15.73 21.25 18.75 17.98 18.75 14.25C18.75 9.4 12 2.75 12 2.75Z'),
  line('M8.75 14.5C8.75 16.3 10 17.75 11.75 18'),
];

/** Normal type: the plain ring of the games' type badge. */
const NormalTypeIcon: IconData = [circle(12, 12, 8.75), circle(12, 12, 3.75)];

/** Psychic type: a spiral. */
const PsychicTypeIcon: IconData = [
  line('M12 12A1.5 1.5 0 0 1 15 12A3 3 0 0 1 9 12A4.5 4.5 0 0 1 18 12A6 6 0 0 1 6 12A7.5 7.5 0 0 1 21 12'),
];

/** Dragon type: three claw marks. */
const DragonTypeIcon: IconData = [
  line('M4.75 20.25C5.5 14.5 8.5 9.25 14.25 5.75'),
  line('M9.25 21.25C10.25 16.5 13 12.75 17.75 10'),
  line('M14.25 21.25C15 18.25 16.75 16 19.25 14.5'),
  line('M14.25 5.75L17.25 2.75M17.75 10L20.25 7.75'),
];

export const TYPE_ICONS: Record<PokeType, IconData> = {
  normal: NormalTypeIcon,
  fire: FireIcon,
  water: DropletIcon,
  electric: ZapIcon,
  grass: Leaf01Icon,
  ice: SnowIcon,
  fighting: BoxingGlove01Icon,
  poison: BiohazardIcon,
  ground: ShovelIcon,
  flying: FeatherIcon,
  psychic: PsychicTypeIcon,
  bug: Bug01Icon,
  rock: StoneIcon,
  ghost: GhostIcon,
  dragon: DragonTypeIcon,
  dark: Moon02Icon,
  steel: Hexagon01Icon,
  fairy: SparklesIcon,
};

export {
  Alert01Icon as Alert, ArrowUp02Icon as ArrowUp, BirdIcon as Bird, FeatherIcon as Feather, Brain01Icon as Brain, CastleIcon as Castle, Copy01Icon as Copy, CrosshairIcon as Crosshair,
  CrownIcon as Crown, Dumbbell01Icon as Dumbbell, FavouriteIcon as Heart, FireIcon as Flame, FootprintsIcon as Footprints,
  InformationCircleIcon as Info, Key01Icon as Key, Layers01Icon as Layers, Medal01Icon as Medal, MountainIcon as Mountain,
  PencilEdit01Icon as Pencil, RefreshIcon as Refresh, Robot01Icon as Bot, Shield01Icon as Shield, SparklesIcon as Sparkles,
  SwordsIcon as Swords, Target01Icon as Target, Tick02Icon as Tick, Timer01Icon as Timer, TrophyIcon as Trophy,
  UserGroupIcon as Users, UserIcon as User, VolumeHighIcon as VolumeOn, VolumeOffIcon as VolumeOff, ZapIcon as Zap,
  StarIcon as Star, SquareLock02Icon as Lock, PlayIcon as Play, PauseIcon as Pause, Share08Icon as Share, PuzzleIcon as Puzzle,
  Calendar03Icon as Calendar, Route01Icon as Route, Forward01Icon as FastForward, RotateLeft01Icon as Restart, Award01Icon as Award,
  Flag01Icon as Flag, VideoReplayIcon as Replay, MapsIcon as MapIcon, GiftIcon as Gift, GhostIcon as Ghost,
};
