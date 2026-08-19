import { resolveCharacter } from "../utils/characters";
import { useState } from 'react';
import { Fighter, Player, SavedFighter, PersistedState } from '../types';
import charactersData from '../data/characters.json';
import { loadState, saveState } from '../utils/stateManager';

interface Props {
  winnerId: 1 | 2;
  player: Player;
  survivingFighters: Fighter[];
  deadFighters: Fighter[];
  onComplete: () => void;
}

export default function PostMatchProgression({ winnerId, player, survivingFighters, deadFighters, onComplete }: Props) {
  const [fighterUpdates, setFighterUpdates] = useState<Record<string, { name: string; stat: keyof SavedFighter['bonusStats'] | null }>>({});

  const handleNameChange = (id: string, name: string) => {
    setFighterUpdates(prev => ({
      ...prev,
      [id]: { ...prev[id], name }
    }));
  };

  const handleStatChange = (id: string, stat: keyof SavedFighter['bonusStats']) => {
    setFighterUpdates(prev => ({
      ...prev,
      [id]: { ...prev[id], stat }
    }));
  };

  const handleSaveAndContinue = () => {
    const state = loadState();
    const newCustomFighters = { ...state.customFighters };
    const lockedFighterIds: string[] = [];

    survivingFighters.forEach(f => {
      const char = resolveCharacter(f.characterId) || state.customFighters[f.characterId];
      if (!char) return;

      const update = fighterUpdates[f.id] || { name: '', stat: null };
      
      let baseCharId = f.characterId;
      let existingSaved = state.customFighters[f.characterId];
      let baseStats: any = { movement: 0, toughness: 0, attack: 0, defense: 0, arcana: 0 };
      let finalName = update.name || (existingSaved ? existingSaved.name : (char as any).name);
      
      if (existingSaved) {
        baseCharId = existingSaved.baseCharacterId;
        baseStats = { ...existingSaved.bonusStats };
      }

      if (update.stat) {
        baseStats[update.stat] += 1;
      }

      // Reuse the same ID if they are already a veteran to avoid duplicates in state
      const newId = f.characterId.startsWith('vet_') ? f.characterId : `vet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const savedFighter: SavedFighter = {
        id: newId,
        name: finalName,
        baseCharacterId: baseCharId,
        bonusStats: baseStats,
        weaponIds: f.weaponIds,
      };

      newCustomFighters[newId] = savedFighter;
      lockedFighterIds.push(newId);
    });

    state.customFighters = newCustomFighters;
    state.lockedRoster = {
      playerId: winnerId,
      fighterIds: lockedFighterIds,
    };
    
    // Prune dead fighters from the saved roster state and custom fighters so they permanently die
    const deadFighterInstanceIds = new Set(deadFighters.map(f => f.id));
    
    if (state.p1Roster) {
      state.p1Roster = state.p1Roster.filter(r => !deadFighterInstanceIds.has(r.instanceId));
    }
    if (state.p2Roster) {
      state.p2Roster = state.p2Roster.filter(r => !deadFighterInstanceIds.has(r.instanceId));
    }
    
    const deadFighterBaseIds = new Set(deadFighters.map(f => f.characterId));
    deadFighterBaseIds.forEach(id => {
      if (id.startsWith('vet_')) {
        delete state.customFighters[id];
      }
    });

    saveState(state);
    onComplete();
  };

  return (
    <div className="mt-8 border-t border-[#3d3329] pt-6 bg-black/40 p-6 rounded text-left shadow-inner shrink-0">
      <h3 className="text-xl font-bold uppercase tracking-widest text-[#8a7a60] mb-4">Post-Match Progression</h3>
      <p className="text-sm text-[#d4c5a9] mb-6">
        {player.name}'s warband was victorious! Surviving fighters have earned veteran status. 
        Rename them and allocate one bonus stat point each. They will be mandatorily locked into your roster for the next match.
      </p>

      <div className="flex flex-col gap-4">
        {survivingFighters.map(f => {
          const char = resolveCharacter(f.characterId);
          // If it's already a custom fighter, it might not be in charactersData, but it was resolved in GameUI
          const baseChar = char ? char : loadState().customFighters[f.characterId] ? charactersData.find(c => c.id === loadState().customFighters[f.characterId].baseCharacterId) : null;
          const currentName = loadState().customFighters[f.characterId]?.name || baseChar?.name || 'Unknown';
          const update = fighterUpdates[f.id] || { name: '', stat: null };

          return (
            <div key={f.id} className="bg-[#1a1814] border border-[#3d3329] p-4 rounded-sm flex flex-col md:flex-row gap-4 justify-between items-center shadow-md">
              <div className="flex flex-col flex-1 gap-1">
                <span className="text-[#8a7a60] text-xs uppercase tracking-widest">{(baseChar as any)?.emoji} Veteran</span>
                <input 
                  type="text" 
                  value={update.name !== undefined && update.name !== '' ? update.name : ''} 
                  placeholder={currentName}
                  onChange={(e) => handleNameChange(f.id, e.target.value)}
                  className="bg-transparent border-b border-[#3d3329] text-[#d4c5a9] font-bold text-lg outline-none hover:border-[#5c4d3d] focus:border-[#8a7a60] transition-colors w-full"
                />
              </div>

              <div className="flex flex-col flex-1 min-w-[200px]">
                <span className="text-[#8a7a60] text-xs uppercase tracking-widest mb-1">Bonus Stat</span>
                <select
                  value={update.stat || ''}
                  onChange={(e) => handleStatChange(f.id, e.target.value as any)}
                  className="bg-[#2a251e] border border-[#5c4d3d] p-2 text-sm rounded-sm text-[#d4c5a9] outline-none"
                >
                  <option value="" disabled>Select stat...</option>
                  <option value="movement">+1 Movement</option>
                  <option value="attack">+1 Attack</option>
                  <option value="defense">+1 Defense</option>
                  <option value="toughness">+1 Toughness</option>
                  <option value="arcana">+1 Arcana</option>
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end mt-6">
        <button 
          onClick={handleSaveAndContinue}
          disabled={survivingFighters.some(f => !fighterUpdates[f.id]?.stat)}
          className="px-8 py-3 bg-[#8a7a60] hover:bg-[#a39478] text-[#1a1814] text-sm font-black uppercase tracking-widest shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-sm"
        >
          Save and Continue
        </button>
      </div>
    </div>
  );
}
