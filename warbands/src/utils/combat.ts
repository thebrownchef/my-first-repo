import { resolveCharacter } from "./characters";
import { CharacterData, WeaponData, SavedFighter } from '../types';
import charactersData from '../data/characters.json';
import weaponsData from '../data/weapons.json';
import { loadState } from './stateManager';

export function rollD6(): number {
  return Math.floor(Math.random() * 6) + 1;
}

export function roll2D6(): number {
  return rollD6() + rollD6();
}

export function resolveAttack(
  attacker: CharacterData,
  attackerWeapon: WeaponData,
  defender: CharacterData,
  defenderWeapons: WeaponData[]
): { damage: number; attackRoll: number; defenseRoll: number; rawAttackRoll: number; attackBonus: number; rawDefenseRoll: number; defenseBonus: number } {
  const rawAttackRoll = roll2D6();
  const baseAttackStat = attackerWeapon.requirement === 'arcana' ? attacker.arcana : attacker.attack;
  const attackBonus = baseAttackStat + attackerWeapon.attackBonus;
  const attackRoll = rawAttackRoll + attackBonus;
  
  const defBonus = defenderWeapons.reduce((sum, weapon) => sum + (weapon.defenseBonus || 0), 0);
  const defenseBonus = defender.defense + defBonus;
  const rawDefenseRoll = roll2D6();
  const defenseRoll = rawDefenseRoll + defenseBonus;
  
  const damage = Math.max(0, attackRoll - defenseRoll);
  
  return { damage, attackRoll, defenseRoll, rawAttackRoll, attackBonus, rawDefenseRoll, defenseBonus };
}

export function calculateLoadoutPowerRating(weaponIds: string[]): number {
  if (!weaponIds || weaponIds.length === 0) return 0;
  const weapons = weaponIds.map(wid => weaponsData.find(w => w.id === wid) as any).filter(Boolean);
  
  const maxAttack = weapons.reduce((max, w) => Math.max(max, w.attackBonus || 0), 0);
  const totalDefense = weapons.reduce((sum, w) => sum + (w.defenseBonus || 0), 0);
  
  return maxAttack + totalDefense;
}

export function calculateFighterPowerRating(entry: { charId: string; weaponIds: string[] }): number {
  const state = loadState();
  const custom = state.customFighters[entry.charId];
  
  const baseCharId = custom ? custom.baseCharacterId : entry.charId;
  const char = resolveCharacter(baseCharId) as any;
  if (!char) return 0;
  
  let power = char.power || 0;
  
  if (custom) {
    // Add 2 power for each bonus stat point (ignoring legacy hp field if present)
    const stats = custom.bonusStats;
    const bonusPoints = (stats.movement || 0) + (stats.toughness || 0) + (stats.attack || 0) + (stats.defense || 0) + (stats.arcana || 0);
    power += bonusPoints * 2;
  }
  
  power += calculateLoadoutPowerRating(entry.weaponIds);
  
  return power;
}

export function calculateWarbandPowerRating(roster: { charId: string; weaponIds: string[] }[]): number {
  return roster.reduce((total, fighter) => total + calculateFighterPowerRating(fighter), 0);
}

// Keep for backwards compatibility if needed, but UI should use new names
export const calculatePower = calculateFighterPowerRating;
