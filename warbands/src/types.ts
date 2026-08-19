export interface CharacterData {
  id: string;
  name: string;
  power: number;
  movement: number;
  toughness: number;
  attack: number;
  defense: number;
  arcana: number;
  portraitUrl?: string;
  iconUrl?: string;
  emoji: string;
}

export type StatRequirement = 'attack' | 'defense' | 'movement' | 'toughness' | 'arcana';

export interface WeaponData {
  id: string;
  name: string;
  requirement: StatRequirement;
  requirementValue: number;
  hands: 1 | 2;
  minRange: number;
  maxRange: number;
  attackBonus: number;
  defenseBonus: number;
  power: number;
  iconUrl?: string;
}

export interface Point {
  x: number;
  y: number;
  terrainClassification?: string;
  movementCost?: number;
}

export interface ArenaData {
  id: string;
  name: string;
  theme: 'ruined_chapel' | 'dense_forest' | 'ruined_village';
  gridWidth: number;
  gridHeight: number;
  obstacles: Point[];
  terrain?: Point[];
  generation?: any;
  spawnPointsP1: Point[];
  spawnPointsP2: Point[];
}

export interface SavedFighter {
  id: string; // Unique ID for this specific veteran
  name: string; // Custom name
  baseCharacterId: string; // The character class they started as
  bonusStats: {
    movement: number;
    toughness: number;
    attack: number;
    defense: number;
    arcana: number;
  };
  weaponIds: string[]; // Their preferred loadout
}

export interface RosterEntry {
  instanceId: string; // Unique instance ID
  charId: string; // Can be a base character ID or a SavedFighter ID
  weaponIds: string[];
  isLocked?: boolean; // True if this was a surviving veteran locked into the roster
}

export interface PersistedState {
  p1Roster: RosterEntry[];
  p2Roster: RosterEntry[];
  customFighters: Record<string, SavedFighter>;
  lockedRoster: {
    playerId: 1 | 2;
    fighterIds: string[];
  } | null;
}

export interface Fighter {
  id: string; // Unique instance ID
  playerId: 1 | 2;
  characterId: string;
  weaponIds: string[];
  
  // Current state
  x: number;
  y: number;
  currentHP: number;
  distanceMovedThisTurn: number;
  hasAttackedThisTurn: boolean;
  hasActivatedThisRound: boolean; // True if finished activation
  damageDealt: number;
  kills: number;
}

export interface Player {
  id: 1 | 2;
  type: 'human' | 'ai';
  color: string;
  name: string;
}

export type GamePhase = 'menu' | 'builder' | 'deployment' | 'playing' | 'gameover';
export type DeploymentStyle = 'corners' | 'random' | 'battle-lines' | 'close-quarters';

export type ScenarioType = 'elimination' | 'control_point' | 'breakthrough' | 'relic';
export interface ScenarioState {
  type: ScenarioType;
  roundLimit: number;
  controlZone?: Point[];
  controlScoreP1?: number;
  controlScoreP2?: number;
  controlScoreTarget?: number;
  relicPoint?: Point;
  relicCarrierId?: string | null;
}

export const BASE_HP = 5;
