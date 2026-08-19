import { resolveCharacter } from "../utils/characters";
import { getAssetUrl } from '../utils/assets';
import { Fighter, Player, BASE_HP } from '../types';
import charactersData from '../data/characters.json';
import weaponsDataJson from '../data/weapons.json';

const weaponsData = weaponsDataJson as import('../types').WeaponData[];

interface Props {
  fighter: Fighter | null;
  player: Player | null;
  onEndActivation: () => void;
  isFightersTurn: boolean;
  canEndActivation: boolean;
  allActivePlayerFightersActivated?: boolean;
}

export default function SidePanel({ fighter, player, onEndActivation, isFightersTurn, canEndActivation, allActivePlayerFightersActivated }: Props) {
  if (!fighter) {
    return (
      <div className={`bg-[#1a1814]/90 backdrop-blur-md border border-[#3d3329] rounded p-6 flex flex-col justify-center items-center text-[#8a7a60] italic transition-all duration-500 shadow-2xl ${allActivePlayerFightersActivated ? 'opacity-50 saturate-50' : ''}`}>
        Select a fighter to view details.
      </div>
    );
  }

  const char = resolveCharacter(fighter.characterId)!;
  const equippedWeapons = fighter.weaponIds.map(wid => weaponsData.find(w => w.id === wid)!);
  const maxHP = BASE_HP + char.toughness;
  
  const attackBonus = equippedWeapons.reduce((max, w) => Math.max(max, w.attackBonus || 0), 0);
  const defenseBonus = equippedWeapons.reduce((max, w) => Math.max(max, w.defenseBonus || 0), 0);
  const totalAttack = equippedWeapons.length > 0
    ? Math.max(...equippedWeapons.map(w => ((char as any)[w.requirement] as number || char.attack) + (w.attackBonus || 0)))
    : char.attack;
  const totalDefense = char.defense + defenseBonus;

  return (
    <div className={`bg-[#1a1814]/95 backdrop-blur-xl border border-[#3d3329] rounded flex flex-col transition-all duration-500 shadow-2xl overflow-y-auto max-h-full ${allActivePlayerFightersActivated ? 'opacity-50 saturate-50' : ''}`}>
      {getAssetUrl((char as any).portraitUrl) ? (
        <div className="w-full aspect-[4/3] relative border-b border-[#3d3329] shrink-0">
          <img src={getAssetUrl((char as any).portraitUrl)} alt={char.name} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1a1814] via-[#1a1814]/40 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
            <div>
              <h2 className="text-3xl font-bold text-[#d4c5a9] tracking-tight drop-shadow-md">{char.name}</h2>
              <p className="text-xs uppercase tracking-widest drop-shadow" style={{ color: player?.color || '#8a7a60' }}>
                {player?.name || (fighter.playerId === 1 ? 'Player 1' : 'Player 2')}
              </p>
            </div>
            <div className={`relative w-10 h-10 flex items-center justify-center rounded-sm text-[#1a1814] font-black text-xl shadow-md overflow-hidden shrink-0`} style={{ backgroundColor: player?.color || (fighter.playerId === 1 ? '#3b82f6' : '#ef4444') }}>
              <span className="absolute inset-0 flex items-center justify-center leading-none text-2xl z-20">{(char as any).emoji}</span>
              {getAssetUrl((char as any).iconUrl) && (
                <img src={getAssetUrl((char as any).iconUrl)} alt={char.name} className="absolute inset-0 w-full h-full object-cover z-30" />
              )}
            </div>
          </div>
        </div>
      ) : (char as any).portraitUrl ? (
        <div className="w-full aspect-[4/3] relative border-b border-[#3d3329] shrink-0 bg-[#221e1a] flex items-center justify-center">
          <span className="text-8xl opacity-50">{(char as any).emoji}</span>
          <div className="absolute inset-0 bg-gradient-to-t from-[#1a1814] via-[#1a1814]/40 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
            <div>
              <h2 className="text-3xl font-bold text-[#d4c5a9] tracking-tight drop-shadow-md">{char.name}</h2>
              <p className="text-xs uppercase tracking-widest drop-shadow" style={{ color: player?.color || '#8a7a60' }}>
                {player?.name || (fighter.playerId === 1 ? 'Player 1' : 'Player 2')}
              </p>
            </div>
            <div className={`relative w-10 h-10 flex items-center justify-center rounded-sm text-[#1a1814] font-black text-xl shadow-md overflow-hidden shrink-0`} style={{ backgroundColor: player?.color || (fighter.playerId === 1 ? '#3b82f6' : '#ef4444') }}>
              <span className="absolute inset-0 flex items-center justify-center leading-none text-2xl z-20">{(char as any).emoji}</span>
              {getAssetUrl((char as any).iconUrl) && (
                <img src={getAssetUrl((char as any).iconUrl)} alt={char.name} className="absolute inset-0 w-full h-full object-cover z-30" />
              )}
            </div>
          </div>
        </div>
      ) : null}
      
      <div className={`p-4 bg-[#221e1a]/50 border-b border-[#3d3329] ${(char as any).portraitUrl ? 'pt-4' : ''}`}>
        {!(char as any).portraitUrl && (
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-2xl font-bold text-[#d4c5a9] tracking-tight">{char.name}</h2>
              <p className="text-xs uppercase tracking-widest" style={{ color: player?.color || '#8a7a60' }}>
                {player?.name || (fighter.playerId === 1 ? 'Player 1' : 'Player 2')}
              </p>
            </div>
            <div className={`relative w-12 h-12 flex items-center justify-center rounded-sm text-[#1a1814] font-black text-xl shadow-md overflow-hidden`} style={{ backgroundColor: player?.color || (fighter.playerId === 1 ? '#3b82f6' : '#ef4444') }}>
              <span className="absolute inset-0 flex items-center justify-center leading-none text-2xl z-20">{(char as any).emoji}</span>
              {getAssetUrl((char as any).iconUrl) && (
                <img src={getAssetUrl((char as any).iconUrl)} alt={char.name} className="absolute inset-0 w-full h-full object-cover z-30" />
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-6 gap-1 mb-6">
          <div className="flex flex-col items-center bg-[#1a1814] py-2 border border-[#3d3329]">
            <span className="text-[9px] text-[#8a7a60] uppercase">Mov</span>
            <span className="text-white font-bold">{char.movement}</span>
          </div>
          <div className="flex flex-col items-center bg-[#1a1814] py-2 border border-[#3d3329]">
            <span className="text-[9px] text-[#8a7a60] uppercase">Tgh</span>
            <span className="text-white font-bold">{char.toughness}</span>
          </div>
          <div className="flex flex-col items-center bg-[#1a1814] py-2 border border-[#3d3329]">
            <span className="text-[9px] text-[#8a7a60] uppercase">Atk</span>
            <span className="text-white font-bold">{totalAttack}</span>
          </div>
          <div className="flex flex-col items-center bg-[#1a1814] py-2 border border-[#3d3329]">
            <span className="text-[9px] text-[#8a7a60] uppercase">Def</span>
            <span className="text-white font-bold">{totalDefense}</span>
          </div>
          <div className="flex flex-col items-center bg-[#1a1814] py-2 border border-[#3d3329]">
            <span className="text-[9px] text-[#8a7a60] uppercase">Arc</span>
            <span className="text-white font-bold">{char.arcana}</span>
          </div>
          <div className="flex flex-col items-center bg-[#1a1814] py-2 border border-[#3d3329] border-red-900/50">
            <span className="text-[9px] text-red-500 uppercase">HP</span>
            <span className="text-red-500 font-bold">{fighter.currentHP}/{maxHP}</span>
          </div>
        </div>

        <div>
          <div className="text-[10px] text-[#8a7a60] uppercase tracking-widest mb-2">Equipped Weapons</div>
          <div className="bg-[#1a1814] p-3 border border-[#3d3329] text-sm space-y-2">
            {equippedWeapons.map((weapon, i) => (
              <div key={i} className="flex items-center gap-2">
                {getAssetUrl(weapon.iconUrl) ? (
                  <img src={getAssetUrl(weapon.iconUrl)} alt={weapon.name} className="w-8 h-8 rounded-sm border border-[#3d3329] object-cover shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-sm border border-[#3d3329] bg-[#221e1a] flex items-center justify-center shrink-0">🗡️</div>
                )}
                <div className="flex flex-col">
                  <span className="text-[#d4c5a9] font-bold leading-none">{weapon.name}</span>
                  <span className="text-[#8a7a60] font-mono text-[10px] leading-tight mt-1">
                    ({weapon.hands}H, Rng {weapon.minRange}-{weapon.maxRange}, Atk +{weapon.attackBonus}, Def +{weapon.defenseBonus})
                  </span>
                </div>
              </div>
            ))}
            {equippedWeapons.length === 0 && (
              <div className="text-gray-500 italic text-xs">Unarmed</div>
            )}
          </div>
        </div>

        <div className="pt-4 mt-4 border-t border-[#3d3329]">
          <div className="text-[10px] text-[#8a7a60] uppercase tracking-widest mb-2">Status</div>
          <div className="flex gap-2 font-mono text-xs">
            <span className={`px-2 py-1 border ${fighter.distanceMovedThisTurn >= char.movement ? 'bg-[#2a251e] border-[#3d3329] text-gray-500' : 'bg-green-900/20 border-green-900 text-green-500'}`}>
              {fighter.distanceMovedThisTurn >= char.movement ? 'MOVED' : `MOVE (${char.movement - fighter.distanceMovedThisTurn})`}
            </span>
            <span className={`px-2 py-1 border ${fighter.hasAttackedThisTurn ? 'bg-[#2a251e] border-[#3d3329] text-gray-500' : 'bg-red-900/20 border-red-900 text-red-500'}`}>
              {fighter.hasAttackedThisTurn ? 'ATTACKED' : 'ATTACK'}
            </span>
          </div>
        </div>
      </div>

      <div className="p-6">
        {isFightersTurn && canEndActivation && (
          <button 
            onClick={onEndActivation}
            className="w-full py-3 bg-[#5c4d3d] hover:bg-[#8a7a60] text-[#d4c5a9] hover:text-[#1a1814] font-bold text-sm border border-[#8a7a60] shadow-md transition-colors uppercase tracking-widest"
          >
            End Activation
          </button>
        )}
      </div>
    </div>
  );
}
