import { CharacterData } from '../types';
import charactersDataJson from '../data/characters.json';
import { loadState } from './stateManager';

const charactersData = charactersDataJson as CharacterData[];

export function resolveCharacter(characterId: string): CharacterData {
  const state = loadState();
  const custom = state.customFighters[characterId];
  
  if (custom) {
    const baseChar = charactersData.find(c => c.id === custom.baseCharacterId);
    if (!baseChar) throw new Error('Base character not found');
    
    return {
      ...baseChar,
      id: custom.id,
      name: custom.name || baseChar.name,
      movement: baseChar.movement + (custom.bonusStats.movement || 0),
      toughness: baseChar.toughness + (custom.bonusStats.toughness || 0),
      attack: baseChar.attack + (custom.bonusStats.attack || 0),
      defense: baseChar.defense + (custom.bonusStats.defense || 0),
      arcana: baseChar.arcana + (custom.bonusStats.arcana || 0),
    };
  }

  const char = charactersData.find(c => c.id === characterId);
  if (!char) {
    // Fallback if we really can't find it (shouldn't happen)
    return charactersData[0];
  }
  return char;
}
