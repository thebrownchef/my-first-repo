import { resolveCharacter } from "../utils/characters";
import { calculateFighterPowerRating, calculateWarbandPowerRating } from '../utils/combat';
import { useState, useEffect } from 'react';
import { ArenaData, Player, Fighter, WeaponData, DeploymentStyle, Point, BASE_HP, RosterEntry, ScenarioType } from '../types';
import charactersData from '../data/characters.json';
import arenasDataJson from '../data/arenas.json';
import weaponsDataJson from '../data/weapons.json';
import { generateArenaLayout } from '../utils/arenaGenerator';
import { getAssetUrl } from '../utils/assets';
import { loadState, clearState, saveState } from '../utils/stateManager';

const defaultWeaponsMap: Record<string, string[]> = {
  scout: ['sling', 'sword'],
  fanatic: ['flying_embers', 'sword'],
  spy: ['sling', 'sword'],
  ranger: ['sling', 'club'],
  sentinel: ['sword', 'buckler'],
  cultist: ['flying_embers', 'spear'],
  druid: ['flying_embers', 'club'],
  priest: ['fire_brand', 'buckler'],
  mage: ['scorching_ray'],
  berserker: ['battleaxe'],
  knight: ['spear', 'buckler'],
  assassin: ['bow'],
  warrior: ['battleaxe'],
  guard: ['club', 'buckler'],
  bulwark: ['tower_shield']
};

const getDefaultWeapons = (charId: string) => defaultWeaponsMap[charId] || [];

const weaponsData = weaponsDataJson as WeaponData[];
const arenasData = arenasDataJson as ArenaData[];

const meetsRequirements = (char: any, item: WeaponData) => {
  if (!char || !item.requirement) return true;
  const reqVal = item.requirementValue || 1;
  if (item.requirement === 'movement') {
    return char.movement >= 5 + reqVal;
  }
  return char[item.requirement] >= reqVal;
};

interface Props {
  player1: Player;
  setPlayer1: (p: Player) => void;
  player2: Player;
  setPlayer2: (p: Player) => void;
  onStart: (roster: Fighter[], arena: ArenaData, deploymentStyle: DeploymentStyle, scenarioType: ScenarioType | 'random') => void;
}

export default function WarbandBuilder({ player1, setPlayer1, player2, setPlayer2, onStart }: Props) {
  const [p1Roster, setP1Roster] = useState<RosterEntry[]>([]);
  const [p2Roster, setP2Roster] = useState<RosterEntry[]>([]);
  const [arenaId, setArenaId] = useState(arenasData[0].id);
  const [generatedLayout, setGeneratedLayout] = useState<{ obstacles: Point[], terrain: Point[], width: number, height: number } | null>(null);
  const [deploymentStyle, setDeploymentStyle] = useState<DeploymentStyle>('corners');
  const [scenarioType, setScenarioType] = useState<ScenarioType | 'random'>('random');
  const [forceBalance, setForceBalance] = useState(true);

  const [showMenu, setShowMenu] = useState(true);
  const [hasSave, setHasSave] = useState(false);

  // Check for save on mount
  useEffect(() => {
    const state = loadState();
    if ((state.p1Roster && state.p1Roster.length > 0) || (state.p2Roster && state.p2Roster.length > 0) || state.lockedRoster) {
      setHasSave(true);
    } else {
      setShowMenu(false);
    }
  }, []);

  const handleContinueGame = () => {
    const state = loadState();
    let initialP1 = state.p1Roster || [];
    let initialP2 = state.p2Roster || [];

    // Exclusively load surviving veteran fighters, clearing standard non-veterans, and ensuring they remain locked
    initialP1 = initialP1.filter(f => f.charId.startsWith('vet_')).map(f => ({ ...f, isLocked: true, instanceId: f.instanceId || Math.random().toString(36).substring(2, 9) }));
    initialP2 = initialP2.filter(f => f.charId.startsWith('vet_')).map(f => ({ ...f, isLocked: true, instanceId: f.instanceId || Math.random().toString(36).substring(2, 9) }));

    if (state.lockedRoster) {
      const lockedEntries: RosterEntry[] = state.lockedRoster.fighterIds.map(id => ({
        instanceId: Math.random().toString(36).substring(2, 9),
        charId: id,
        weaponIds: state.customFighters[id]?.weaponIds || [],
        isLocked: true
      }));
      
      if (state.lockedRoster.playerId === 1) {
        initialP1 = [...lockedEntries, ...initialP1.filter(f => !lockedEntries.some(l => l.charId === f.charId))];
      } else {
        initialP2 = [...lockedEntries, ...initialP2.filter(f => !lockedEntries.some(l => l.charId === f.charId))];
      }
      
      state.lockedRoster = null;
      saveState(state);
    }

    setP1Roster(initialP1);
    setP2Roster(initialP2);
    setShowMenu(false);
  };

  const handleNewGame = () => {
    clearState();
    setP1Roster([]);
    setP2Roster([]);
    setShowMenu(false);
  };

  // Save roster when it changes
  useEffect(() => {
    if (showMenu) return; // Don't save while in menu
    if (p1Roster.length === 0 && p2Roster.length === 0) return;
    
    const state = loadState();
    state.p1Roster = p1Roster;
    state.p2Roster = p2Roster;
    saveState(state);
  }, [p1Roster, p2Roster, showMenu]);

  const handleRerollArena = () => {
    let targetId = arenaId;
    if (targetId === 'random') {
      targetId = arenasData[Math.floor(Math.random() * arenasData.length)].id;
    }
    const arena = arenasData.find(a => a.id === targetId)!;
    setGeneratedLayout(generateArenaLayout(arena));
  };

  useEffect(() => {
    handleRerollArena();
  }, [arenaId]);

  const MAX_FIGHTERS = 10;
  const MAX_TEAM_POWER = 100;

  const p1Power = calculateWarbandPowerRating(p1Roster);
  const p2Power = calculateWarbandPowerRating(p2Roster);
  const maxPower = Math.max(p1Power, p2Power, 1);
  const powerDiff = Math.abs(p1Power - p2Power);
  const isBalanced = powerDiff <= 10;
  const isP1OverPower = p1Power > MAX_TEAM_POWER;
  const isP2OverPower = p2Power > MAX_TEAM_POWER;

  const handleAutoPickRandom = (playerId: 1 | 2) => {
    const targetPower = playerId === 1 ? (p2Roster.length > 0 ? p2Power : Math.floor(MAX_TEAM_POWER / 2)) : (p1Roster.length > 0 ? p1Power : Math.floor(MAX_TEAM_POWER / 2));
    
    const newRoster: RosterEntry[] = [];
    let currentPower = 0;
    
    const validChars = charactersData.filter(c => getDefaultWeapons(c.id).length > 0);
    
    for (let i = 0; i < MAX_FIGHTERS; i++) {
      if (Math.abs(targetPower - currentPower) <= 10) {
        // If we're already within 10, maybe stop? 
        // We'll stop, unless we're exactly 0 and target is 0? If target is 0, we're at 0, diff is 0, we stop.
        // Actually, let's keep picking if we're under target minus 10.
      }
      
      if (currentPower >= targetPower - 10 && currentPower <= targetPower + 10) {
        break; // Within 10 power, stop!
      }
      
      const remainingPower = MAX_TEAM_POWER - currentPower;
      
      // Filter characters that wouldn't put us over MAX_TEAM_POWER or targetPower + 10
      const options = validChars.filter(c => {
         const p = calculateFighterPowerRating({ charId: c.id, weaponIds: getDefaultWeapons(c.id) });
         return currentPower + p <= MAX_TEAM_POWER && currentPower + p <= targetPower + 10;
      });
      
      if (options.length === 0) break;
      
      const char = options[Math.floor(Math.random() * options.length)];
      const weaponIds = getDefaultWeapons(char.id);
      
      newRoster.push({ instanceId: Math.random().toString(36).substring(2, 9), charId: char.id, weaponIds });
      currentPower += calculateFighterPowerRating({ charId: char.id, weaponIds });
    }
    
    if (playerId === 1) setP1Roster(newRoster);
    else setP2Roster(newRoster);
  };

  const handleAutoPickSmart = (playerId: 1 | 2) => {
    const targetPower = playerId === 1 ? (p2Roster.length > 0 ? p2Power : Math.floor(MAX_TEAM_POWER / 2)) : (p1Roster.length > 0 ? p1Power : Math.floor(MAX_TEAM_POWER / 2));
    
    const newRoster: RosterEntry[] = [];
    let currentPower = 0;
    
    const allCombos = charactersData.map(c => {
       const weaponIds = getDefaultWeapons(c.id);
       return { char: c, wpnIds: weaponIds };
    }).filter(combo => combo.wpnIds.length > 0);

    for (let i = 0; i < MAX_FIGHTERS; i++) {
       let bestCombo = null;
       let bestDiff = Math.abs(targetPower - currentPower);
       
       for (const combo of allCombos) {
          const comboPower = calculateFighterPowerRating({ charId: combo.char.id, weaponIds: combo.wpnIds });
          if (currentPower + comboPower <= MAX_TEAM_POWER) {
             const newDiff = Math.abs(targetPower - (currentPower + comboPower));
             if (newDiff < bestDiff) {
                bestDiff = newDiff;
                bestCombo = combo;
             }
          }
       }
       
       if (!bestCombo) break;
       
       newRoster.push({ instanceId: Math.random().toString(36).substring(2, 9), charId: bestCombo.char.id, weaponIds: bestCombo.wpnIds });
       currentPower += calculateFighterPowerRating({ charId: bestCombo.char.id, weaponIds: bestCombo.wpnIds });
    }
    
    if (playerId === 1) setP1Roster(newRoster);
    else setP2Roster(newRoster);
  };

  const handleAddFighter = (playerId: 1 | 2, charId: string) => {
    const char = resolveCharacter(charId)!;
    const weaponIds = getDefaultWeapons(char.id);
    const newFighter: RosterEntry = { instanceId: Math.random().toString(36).substring(2, 9), charId, weaponIds };
    
    if (playerId === 1 && p1Roster.length < MAX_FIGHTERS) {
      setP1Roster([...p1Roster, newFighter]);
    } else if (playerId === 2 && p2Roster.length < MAX_FIGHTERS) {
      setP2Roster([...p2Roster, newFighter]);
    }
  };

  const handleRemoveFighter = (playerId: 1 | 2, index: number) => {
    if (playerId === 1) {
      if (p1Roster[index]?.isLocked) return;
      setP1Roster(p1Roster.filter((_, i) => i !== index));
    } else {
      if (p2Roster[index]?.isLocked) return;
      setP2Roster(p2Roster.filter((_, i) => i !== index));
    }
  };

  const renderHoverCard = (char: any, playerId: 1 | 2) => {
    const pColor = playerId === 1 ? player1.color : player2.color;
    const defaultWpns = getDefaultWeapons(char.id).map(wid => weaponsData.find(w => w.id === wid)!);
    const attackBonus = defaultWpns.reduce((max, w) => Math.max(max, w.attackBonus || 0), 0);
    const defenseBonus = defaultWpns.reduce((sum, w) => sum + (w.defenseBonus || 0), 0);
    const loadoutPowerRating = attackBonus + defenseBonus;
    const fighterPowerRating = char.power + loadoutPowerRating;
    const totalAttack = char.attack + attackBonus;
    const totalDefense = char.defense + defenseBonus;
    return (
    <div className="absolute left-0 bottom-full mb-2 z-50 hidden group-hover/recruit:flex flex-col w-64 bg-[#1a1814]/95 backdrop-blur-xl border border-[#3d3329] rounded shadow-2xl p-0 overflow-hidden pointer-events-none">
      {getAssetUrl(char.portraitUrl) ? (
        <div className="w-full aspect-square relative border-b border-[#3d3329]">
          <img src={getAssetUrl(char.portraitUrl)} alt={char.name} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1a1814] to-transparent opacity-80" />
        </div>
      ) : char.portraitUrl ? (
        <div className="w-full aspect-square relative border-b border-[#3d3329] flex items-center justify-center bg-[#221e1a]">
          <span className="text-6xl opacity-50">{char.emoji}</span>
          <div className="absolute inset-0 bg-gradient-to-t from-[#1a1814] to-transparent opacity-80" />
        </div>
      ) : null}
      <div className="p-4 pt-3">
        <div className="flex items-center gap-3 mb-3">
          <div className={`relative w-10 h-10 shrink-0 flex items-center justify-center rounded-sm text-[#1a1814] font-black text-xl shadow-md overflow-hidden`} style={{ backgroundColor: pColor }}>
            <span className="absolute inset-0 flex items-center justify-center leading-none text-2xl z-20">{char.emoji}</span>
            {getAssetUrl(char.iconUrl) && (
              <img src={getAssetUrl(char.iconUrl)} alt={char.name} className="absolute inset-0 w-full h-full object-cover z-30" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[#d4c5a9] font-bold leading-none truncate">{char.name}</div>
            <div className="text-[#8a7a60] text-xs uppercase tracking-widest mt-1">Class Stats</div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 mb-2">
          <div className="flex flex-col items-center bg-[#221e1a] py-1 border border-[#3d3329] rounded-sm">
            <span className="text-[9px] text-[#8a7a60] uppercase">HP</span>
            <span className="text-white font-bold">{BASE_HP + char.toughness}</span>
          </div>
          <div className="flex flex-col items-center bg-[#221e1a] py-1 border border-[#3d3329] rounded-sm">
            <span className="text-[9px] text-[#8a7a60] uppercase">Mov</span>
            <span className="text-white font-bold">{char.movement}</span>
          </div>
          <div className="flex flex-col items-center bg-[#221e1a] py-1 border border-[#3d3329] rounded-sm">
            <span className="text-[9px] text-[#8a7a60] uppercase">Atk</span>
            <span className="text-white font-bold">{totalAttack}</span>
          </div>
          <div className="flex flex-col items-center bg-[#221e1a] py-1 border border-[#3d3329] rounded-sm">
            <span className="text-[9px] text-[#8a7a60] uppercase">Def</span>
            <span className="text-white font-bold">{totalDefense}</span>
          </div>
        </div>
        <div className="text-[10px] text-[#8a7a60] mt-2 border-t border-[#3d3329] pt-2 flex flex-col gap-1">
          <div className="flex justify-between">
            <span className="text-[#d4c5a9] font-bold">Power Rating</span>
            <span className="text-[#d4c5a9] font-bold">{fighterPowerRating}</span>
          </div>
        </div>
      </div>
    </div>
  );
  }
  
  const handleWeaponChange = (playerId: 1 | 2, fighterIndex: number, weaponSlot: 0 | 1, newWeaponId: string | '') => {
     const setRoster = playerId === 1 ? setP1Roster : setP2Roster;
     const roster = playerId === 1 ? [...p1Roster] : [...p2Roster];
     const f = roster[fighterIndex];
     
     // Prevent changing weapons for locked veterans? The prompt says lock them into the roster. 
     // We can allow weapon changes unless we shouldn't. Let's allow weapon changes.
     
     if (newWeaponId === '') {
       f.weaponIds = f.weaponIds.filter((_, idx) => idx !== weaponSlot);
     } else {
       if (weaponSlot < f.weaponIds.length) {
         f.weaponIds[weaponSlot] = newWeaponId;
       } else {
         f.weaponIds.push(newWeaponId);
       }
       
       // Enforce 2H constraint
       const wpns = f.weaponIds.map(wid => weaponsData.find(w => w.id === wid)!);
       let totalHands = wpns.reduce((sum, w) => sum + w.hands, 0);
       
       if (totalHands > 2) {
          // If we just added/changed a 2H weapon, remove the other slot
          if (weaponsData.find(w => w.id === newWeaponId)!.hands === 2) {
             f.weaponIds = [newWeaponId];
          } else {
             // If we added a 1H and it exceeded 2 (meaning the other was 2H), remove the 2H
             f.weaponIds = [newWeaponId];
          }
       }
     }
     
     setRoster(roster);
  };

  const renderWeaponSlot = (f: RosterEntry, char: any, playerId: 1 | 2, i: number, slot: 0 | 1) => {
     const currentId = slot < f.weaponIds.length ? f.weaponIds[slot] : '';
     // If slot 1 is disabled because slot 0 is 2H
     const isSlot0TwoHanded = f.weaponIds.length > 0 && weaponsData.find(w => w.id === f.weaponIds[0])?.hands === 2;
     if (slot === 1 && isSlot0TwoHanded) return null;
     
     const currentWeapon = weaponsData.find(w => w.id === currentId);
     

     return (
        <div className="flex flex-col gap-1 flex-1 relative group mt-1" >
          <div className="flex items-center gap-1 w-full">
            {getAssetUrl(currentWeapon?.iconUrl) ? <img src={getAssetUrl(currentWeapon.iconUrl)} alt={currentWeapon.name} className="w-6 h-6 rounded-sm border border-[#5c4d3d] shrink-0 object-cover" /> : <div className="w-6 h-6 rounded-sm border border-[#5c4d3d] shrink-0 flex items-center justify-center text-xs bg-[#221e1a]">🗡️</div>}
            <select 
              className="bg-[#1a1814] border border-[#5c4d3d] text-xs p-1 rounded-sm text-[#d4c5a9] outline-none w-full"
              value={currentId}
              onChange={(e) => handleWeaponChange(playerId, i, slot, e.target.value)}
            >
              <option value="">{slot === 0 ? "Select Weapon" : "No Weapon (Empty Hand)"}</option>
              {weaponsData.map(w => {
                 const valid = meetsRequirements(char, w);
                 if (!valid) {
                   return null;
                 }
                 return <option key={w.id} value={w.id}>{w.name} ({w.hands}H) — {w.maxRange > 1 ? 'Ranged' : 'Melee'} — Atk {w.attackBonus || 0} — Def {w.defenseBonus || 0}</option>;
              })}
            </select>
          </div>
          {currentWeapon && (
            <div className="text-[10px] text-[#a09480] bg-[#1a1814] border border-[#4a3f32] p-1 rounded-sm flex justify-between px-2">
              <span>Atk: {currentWeapon.attackBonus || 0}</span>
              <span>Def: {currentWeapon.defenseBonus || 0}</span>
              <span>{currentWeapon.maxRange > 1 ? 'Ranged' : 'Melee'}</span>
            </div>
          )}
        </div>
     );
  };

  const renderRoster = (roster: RosterEntry[], playerId: 1 | 2) => {
    const pColor = playerId === 1 ? player1.color : player2.color;
    return (
    <div className="mb-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-[#5c4d3d] to-[#5c4d3d]"></div>
        <h3 className="text-[11px] uppercase tracking-[0.2em] text-[#8a7a60] font-bold">Currently Recruited</h3>
        <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent via-[#5c4d3d] to-[#5c4d3d]"></div>
      </div>
      <div className="space-y-2 min-h-[160px]">
        {roster.map((f, i) => {
        const state = loadState();
        const custom = state.customFighters[f.charId];
        const char = resolveCharacter(f.charId)!;
        const displayName = custom ? custom.name : char.name;
        const displayPortrait = (char as any).portraitUrl;
        
        return (
        <div key={i} className={`bg-[#2a251e] p-2 border-l-4 flex flex-col gap-2 shadow-md`} style={{ borderLeftColor: pColor }}>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              {getAssetUrl(displayPortrait) ? <img src={getAssetUrl(displayPortrait)} alt={displayName} className="w-8 h-8 rounded-full border border-[#5c4d3d] object-cover shrink-0" /> : <div className="w-8 h-8 rounded-full border border-[#5c4d3d] shrink-0 flex items-center justify-center text-sm bg-[#221e1a]">{(char as any).emoji || '👤'}</div>}
              <span className="text-[#d4c5a9] text-sm font-bold">{displayName} {custom && <span className="text-yellow-500 text-xs ml-1">⭐ Veteran</span>} <span className="opacity-70 font-normal ml-1">(Power Rating: {calculateFighterPowerRating(f)})</span></span>
            </div>
            {f.isLocked ? (
              <span className="text-[#8a7a60] text-[10px] uppercase font-bold tracking-widest px-2">Locked</span>
            ) : (
              <button onClick={() => handleRemoveFighter(playerId, i)} style={{ color: pColor }} className="hover:opacity-75 text-xs font-bold uppercase tracking-widest">Remove</button>
            )}
          </div>
          <div className="flex flex-col gap-1">
            {renderWeaponSlot(f, char, playerId, i, 0)}
            {renderWeaponSlot(f, char, playerId, i, 1)}
          </div>
        </div>
      )})}
      {roster.length === 0 && <p className="text-[#8a7a60] text-sm italic text-center py-4">No fighters added.</p>}
      </div>
    </div>
  );
  }

  const handleStart = () => {
    if (p1Roster.length === 0 || p2Roster.length === 0) return;

    let targetArenaId = arenaId;
    if (targetArenaId === 'random') {
      targetArenaId = arenasData[Math.floor(Math.random() * arenasData.length)].id;
    }

    let nextId = 1;
    const finalRoster: Fighter[] = [];

    const baseArena = arenasData.find(a => a.id === targetArenaId)!;
    
    let finalLayout = generatedLayout;
    if (targetArenaId !== arenaId || !finalLayout) {
      finalLayout = generateArenaLayout(baseArena);
    }

    const finalArena: ArenaData = {
      ...baseArena,
      gridWidth: finalLayout ? finalLayout.width : baseArena.gridWidth,
      gridHeight: finalLayout ? finalLayout.height : baseArena.gridHeight,
      obstacles: finalLayout ? finalLayout.obstacles : baseArena.obstacles,
      terrain: finalLayout ? finalLayout.terrain : (baseArena.terrain || [])
    };

    const addToFinal = (r: RosterEntry[], pId: 1|2) => {
      const state = loadState();
      r.forEach((f) => {
        const custom = state.customFighters[f.charId];
        const char = resolveCharacter(f.charId)!;
        
        let maxHP = BASE_HP + char.toughness;

        finalRoster.push({
          id: f.instanceId,
          playerId: pId,
          characterId: f.charId,
          weaponIds: f.weaponIds,
          x: -1,
          y: -1,
          currentHP: maxHP,
          distanceMovedThisTurn: 0,
          hasAttackedThisTurn: false,
          hasActivatedThisRound: false,
          damageDealt: 0,
          kills: 0,
        });
      });
    };
    
    addToFinal(p1Roster, 1);
    addToFinal(p2Roster, 2);

    onStart(finalRoster, finalArena, deploymentStyle, scenarioType);
  };

  const handleRandomStart = () => {
    const validChars = charactersData.filter(c => getDefaultWeapons(c.id).length > 0);
    const p1: RosterEntry[] = [];
    const p2: RosterEntry[] = [];
    for(let i=0; i<3; i++) {
       const char1 = validChars[Math.floor(Math.random()*validChars.length)];
       const weaponIds1 = getDefaultWeapons(char1.id);
       p1.push({ instanceId: Math.random().toString(36).substring(2, 9), charId: char1.id, weaponIds: weaponIds1 });
       
       const char2 = validChars[Math.floor(Math.random()*validChars.length)];
       const weaponIds2 = getDefaultWeapons(char2.id);
       p2.push({ instanceId: Math.random().toString(36).substring(2, 9), charId: char2.id, weaponIds: weaponIds2 });
    }
    
    const randomTargetArena = arenasData[Math.floor(Math.random() * arenasData.length)];
    const randomLayout = generateArenaLayout(randomTargetArena);
    
    const finalArena: ArenaData = {
      ...randomTargetArena,
      gridWidth: randomLayout.width,
      gridHeight: randomLayout.height,
      obstacles: randomLayout.obstacles,
      terrain: randomLayout.terrain
    };

    let nextId = 1;
    const finalRoster: Fighter[] = [];
    const addToFinal = (r: RosterEntry[], pId: 1|2) => {
      const state = loadState();
      r.forEach((f) => {
        const custom = state.customFighters[f.charId];
        const char = resolveCharacter(f.charId)!;
        
        let maxHP = BASE_HP + char.toughness;

        finalRoster.push({
          id: f.instanceId,
          playerId: pId,
          characterId: f.charId,
          weaponIds: f.weaponIds,
          x: -1,
          y: -1,
          currentHP: maxHP,
          distanceMovedThisTurn: 0,
          hasAttackedThisTurn: false,
          hasActivatedThisRound: false,
          damageDealt: 0,
          kills: 0,
        });
      });
    };
    
    addToFinal(p1, 1);
    addToFinal(p2, 2);

    setP1Roster(p1);
    setP2Roster(p2);
    setArenaId('random');
    setDeploymentStyle('random');
    setScenarioType('random');
    
    onStart(finalRoster, finalArena, 'random', 'random');
  };

  if (showMenu) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-12 animate-in fade-in duration-500 w-full max-w-lg mx-auto">
        <div className="text-center">
          <h2 className="text-5xl md:text-7xl font-black uppercase tracking-tighter text-[#d4c5a9] mb-4 drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)]">
            Warbands
          </h2>
          <p className="text-[#8a7a60] uppercase tracking-[0.3em] font-bold text-sm">Tactical Skirmish Engine</p>
        </div>
        
        <div className="flex flex-col w-full gap-4">
          {hasSave && (
            <button 
              onClick={handleContinueGame}
              className="w-full bg-[#8a7a60] border-2 border-[#8a7a60] hover:bg-[#a39478] hover:border-[#a39478] text-[#1a1814] font-black py-4 px-6 rounded-sm transition-all duration-300 shadow-[0_0_20px_rgba(138,122,96,0.3)] hover:shadow-[0_0_30px_rgba(163,148,120,0.5)] hover:scale-105 uppercase tracking-widest text-lg"
            >
              Continue Game
            </button>
          )}
          
          <button 
            onClick={handleNewGame}
            className="w-full bg-[#1a1814] border-2 border-[#3d3329] hover:bg-[#2a251e] hover:border-[#5c4d3d] text-[#d4c5a9] font-bold py-4 px-6 rounded-sm transition-all shadow-lg uppercase tracking-widest text-lg"
          >
            New Game
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8 animate-in fade-in duration-500 w-full max-w-4xl mx-auto">
      <div className="w-full flex justify-end">
        <button 
          onClick={handleRandomStart}
          className="bg-[#1a1814] border-2 border-[#8a7a60] hover:bg-[#2a251e] text-[#d4c5a9] font-bold py-2 px-6 rounded-sm transition-colors shadow-lg uppercase tracking-widest text-sm"
        >
          Random Start
        </button>
      </div>
      <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Player 1 Settings */}
        <div className="bg-[#1a1814] p-6 rounded-sm border-2 border-[#3d3329] shadow-2xl flex flex-col relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1" style={{ backgroundColor: player1.color }}></div>
          <div className="flex flex-col gap-2 mb-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full shadow-sm border border-[#1a1814]" style={{ backgroundColor: player1.color }}></div>
                <input 
                  type="text"
                  value={player1.name}
                  onChange={(e) => setPlayer1({ ...player1, name: e.target.value })}
                  className="text-2xl font-black tracking-tight bg-transparent border-b border-transparent hover:border-[#3d3329] focus:border-[#5c4d3d] outline-none pb-1"
                  style={{ color: player1.color }}
                />
              </div>
              <select 
                className="bg-[#1a1814] border border-[#3d3329] text-sm py-1.5 px-3 rounded-sm text-[#d4c5a9] outline-none hover:border-[#5c4d3d] focus:border-[#8a7a60] transition-colors cursor-pointer font-semibold tracking-wide appearance-none shadow-inner"
                style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a7a60' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1em', paddingRight: '2rem' }}
                value={player1.type}
                onChange={(e) => setPlayer1({ ...player1, type: e.target.value as 'human' | 'ai' })}
              >
                <option value="human">Human</option>
                <option value="ai">AI</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs uppercase tracking-widest text-[#8a7a60]">Color:</label>
              <input 
                type="color" 
                value={player1.color}
                onChange={(e) => setPlayer1({ ...player1, color: e.target.value })}
                className="w-6 h-6 p-0 border-none rounded-sm cursor-pointer"
              />
            </div>
          </div>
          
          <div className="w-full bg-[#2a251e] h-2 rounded-full mb-4 overflow-hidden border border-[#3d3329]">
            <div 
              className={`h-full transition-all duration-300 ${isP1OverPower ? 'bg-red-500' : ''}`} 
              style={{ width: `${(p1Power / maxPower) * 100}%`, backgroundColor: isP1OverPower ? undefined : player1.color }}
            ></div>
          </div>
          
          {renderRoster(p1Roster, 1)}

          <div className="mt-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-[#5c4d3d] to-[#5c4d3d]"></div>
              <h3 className="text-[11px] uppercase tracking-[0.2em] text-[#8a7a60] font-bold">Recruit Roster</h3>
              <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent via-[#5c4d3d] to-[#5c4d3d]"></div>
            </div>
            
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[...charactersData].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((c: any) => (
                <div key={c.id} className="relative group/recruit">
                  <button
                    onClick={() => handleAddFighter(1, c.id)}
                    disabled={p1Roster.length >= MAX_FIGHTERS}
                    className="w-full px-2 py-1.5 border border-[#3d3329] text-[#d4c5a9] text-xs hover:bg-[#2a251e] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 bg-[#1a1814] rounded-sm transition-all hover:border-[#5c4d3d] group-hover/recruit:border-[#8a7a60]"
                  >
                    {getAssetUrl(c.iconUrl) ? <img src={getAssetUrl(c.iconUrl)} alt="" className="w-5 h-5 rounded-sm shrink-0 object-cover border border-[#3d3329]" /> : <div className="w-5 h-5 rounded-sm shrink-0 flex items-center justify-center text-[10px] bg-[#221e1a] border border-[#3d3329]">{c.emoji}</div>}
                    <span className="font-semibold tracking-wide truncate">{c.name}</span>
                    <span className="ml-auto text-[#8a7a60] text-[10px]">+</span>
                  </button>
                  {renderHoverCard(c, 1)}
                </div>
              ))}
            </div>
            <div className="flex justify-center border-t border-[#3d3329] pt-4 mt-2">
              <button
                onClick={() => handleAutoPickRandom(1)}
                className="px-6 py-2 bg-[#1a1814] border border-[#5c4d3d] text-[#8a7a60] text-xs hover:bg-[#2a251e] hover:text-[#d4c5a9] uppercase tracking-wider rounded-sm transition-colors font-bold shadow-md"
              >
                Auto-Pick (Random)
              </button>
            </div>
          </div>
        </div>

        {/* Player 2 Settings */}
        <div className="bg-[#1a1814] p-6 rounded-sm border-2 border-[#3d3329] shadow-2xl flex flex-col relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1" style={{ backgroundColor: player2.color }}></div>
          <div className="flex flex-col gap-2 mb-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full shadow-sm border border-[#1a1814]" style={{ backgroundColor: player2.color }}></div>
                <input 
                  type="text"
                  value={player2.name}
                  onChange={(e) => setPlayer2({ ...player2, name: e.target.value })}
                  className="text-2xl font-black tracking-tight bg-transparent border-b border-transparent hover:border-[#3d3329] focus:border-[#5c4d3d] outline-none pb-1"
                  style={{ color: player2.color }}
                />
              </div>
              <select 
                className="bg-[#1a1814] border border-[#3d3329] text-sm py-1.5 px-3 rounded-sm text-[#d4c5a9] outline-none hover:border-[#5c4d3d] focus:border-[#8a7a60] transition-colors cursor-pointer font-semibold tracking-wide appearance-none shadow-inner"
                style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a7a60' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1em', paddingRight: '2rem' }}
                value={player2.type}
                onChange={(e) => setPlayer2({ ...player2, type: e.target.value as 'human' | 'ai' })}
              >
                <option value="human">Human</option>
                <option value="ai">AI</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs uppercase tracking-widest text-[#8a7a60]">Color:</label>
              <input 
                type="color" 
                value={player2.color}
                onChange={(e) => setPlayer2({ ...player2, color: e.target.value })}
                className="w-6 h-6 p-0 border-none rounded-sm cursor-pointer"
              />
            </div>
          </div>
          
          <div className="w-full bg-[#2a251e] h-2 rounded-full mb-4 overflow-hidden border border-[#3d3329]">
            <div 
              className={`h-full transition-all duration-300 ${isP2OverPower ? 'bg-red-500' : ''}`} 
              style={{ width: `${(p2Power / maxPower) * 100}%`, backgroundColor: isP2OverPower ? undefined : player2.color }}
            ></div>
          </div>
          
          {renderRoster(p2Roster, 2)}

          <div className="mt-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-[#5c4d3d] to-[#5c4d3d]"></div>
              <h3 className="text-[11px] uppercase tracking-[0.2em] text-[#8a7a60] font-bold">Recruit Roster</h3>
              <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent via-[#5c4d3d] to-[#5c4d3d]"></div>
            </div>
            
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[...charactersData].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((c: any) => (
                <div key={c.id} className="relative group/recruit">
                  <button
                    onClick={() => handleAddFighter(2, c.id)}
                    disabled={p2Roster.length >= MAX_FIGHTERS}
                    className="w-full px-2 py-1.5 border border-[#3d3329] text-[#d4c5a9] text-xs hover:bg-[#221e1a] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 bg-[#1a1814] rounded-sm transition-all hover:border-[#5c4d3d] group-hover/recruit:border-[#8a7a60]"
                  >
                    {getAssetUrl(c.iconUrl) ? <img src={getAssetUrl(c.iconUrl)} alt="" className="w-5 h-5 rounded-sm shrink-0 object-cover border border-[#3d3329]" /> : <div className="w-5 h-5 rounded-sm shrink-0 flex items-center justify-center text-[10px] bg-[#221e1a] border border-[#3d3329]">{c.emoji}</div>}
                    <span className="font-semibold tracking-wide truncate">{c.name}</span>
                    <span className="ml-auto text-[#8a7a60] text-[10px]">+</span>
                  </button>
                  {renderHoverCard(c, 2)}
                </div>
              ))}
            </div>
            <div className="flex justify-center border-t border-[#3d3329] pt-4 mt-2">
              <button
                onClick={() => handleAutoPickRandom(2)}
                className="px-6 py-2 bg-[#1a1814] border border-[#5c4d3d] text-[#8a7a60] text-xs hover:bg-[#221e1a] hover:text-[#d4c5a9] uppercase tracking-wider rounded-sm transition-colors font-bold shadow-md"
              >
                Auto-Pick (Random)
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 mt-4">
        
        <div className="flex flex-col items-center mb-4">
          <div className="text-sm font-bold flex items-center gap-2">
            <span style={{ color: isP1OverPower ? '#ef4444' : isBalanced ? '#4ade80' : '#f59e0b' }}>
              {player1.name} Power Rating: {p1Power}
            </span>
            <span className="text-[#8a7a60]">—</span>
            <span style={{ color: isP2OverPower ? '#ef4444' : isBalanced ? '#4ade80' : '#f59e0b' }}>
              {player2.name} Power Rating: {p2Power}
            </span>
          </div>
          {(isP1OverPower || isP2OverPower) && (
            <span className="text-red-500 text-xs italic mt-1">Maximum Warband Power Rating is {MAX_TEAM_POWER}.</span>
          )}
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <input 
              type="checkbox" 
              checked={forceBalance}
              onChange={e => setForceBalance(e.target.checked)}
              className="accent-[#8a7a60]"
            />
            <span className="text-sm text-[#d4c5a9]">Force Balanced Teams</span>
          </label>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <label className="text-[11px] uppercase tracking-[0.2em] text-[#8a7a60]">Arena Theme:</label>
            <select 
              className="bg-[#1a1814] border border-[#5c4d3d] p-2 rounded-sm text-[#d4c5a9] outline-none"
              value={arenaId}
              onChange={(e) => setArenaId(e.target.value)}
            >
              {arenasData.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
              <option value="random">Random</option>
            </select>
            {arenaId !== 'random' && (
              <button 
                onClick={handleRerollArena}
                className="px-3 py-2 bg-[#2a251e] border border-[#5c4d3d] text-[#8a7a60] text-xs hover:bg-[#3a352e] uppercase tracking-wider rounded-sm"
              >
                Reroll
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] uppercase tracking-[0.2em] text-[#8a7a60]">Deployment:</label>
          <select 
            className="bg-[#1a1814] border border-[#5c4d3d] p-2 rounded-sm text-[#d4c5a9] outline-none"
            value={deploymentStyle}
            onChange={(e) => setDeploymentStyle(e.target.value as DeploymentStyle)}
          >
            <option value="corners">Corners</option>
            <option value="random">Random Scatter</option>
            <option value="battle-lines">Battle Lines</option>
            <option value="close-quarters">Close Quarters</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] uppercase tracking-[0.2em] text-[#8a7a60]">Scenario:</label>
          <select 
            className="bg-[#1a1814] border border-[#5c4d3d] p-2 rounded-sm text-[#d4c5a9] outline-none"
            value={scenarioType}
            onChange={(e) => setScenarioType(e.target.value as ScenarioType | 'random')}
          >
            <option value="random">Random</option>
            <option value="elimination">Elimination</option>
            <option value="control_point">Control the Point</option>
            <option value="breakthrough">Breakthrough</option>
            <option value="relic">Recover the Relic</option>
          </select>
        </div>

        <div className="flex flex-col items-center gap-4 w-full">
          <div className="flex gap-4">
            <button 
              onClick={handleStart}
              disabled={p1Roster.length === 0 || p2Roster.length === 0 || isP1OverPower || isP2OverPower || (forceBalance && !isBalanced)}
              className="bg-[#8a7a60] hover:bg-[#a39478] text-[#1a1814] font-bold py-3 px-8 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg uppercase tracking-widest text-sm"
            >
              Start Match
            </button>
          </div>
          {forceBalance && !isBalanced && (
            <span className="text-red-400 text-xs italic">Teams must be within 10 Power Rating points of each other to start normally.</span>
          )}
        </div>
      </div>
    </div>
  );
}
