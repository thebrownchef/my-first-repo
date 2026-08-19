import { resolveCharacter } from "../utils/characters";
import { getAssetUrl } from '../utils/assets';
import { useRef, useEffect, useState } from 'react';
import { Point, Fighter, ArenaData, Player, BASE_HP } from '../types';
import charactersData from '../data/characters.json';
import { motion } from 'motion/react';

interface CombatAnimationState {
  targetId: string;
  attackerId: string;
  targetPoint: Point;
  attackerPoint: Point;
  roll: number;
  targetNumber: number;
  hit: boolean;
  damage: number;
  isRanged: boolean;
  weaponId?: string;
  rawAttackRoll: number;
  attackBonus: number;
  rawDefenseRoll: number;
  defenseBonus: number;
}

interface Props {
  player1: Player;
  player2: Player;
  arena: ArenaData;
  fighters: Fighter[];
  selectedFighterId: string | null;
  reachableSquares: (Point & { cost?: number })[];
  attackableEnemies: string[]; // Fighter IDs
  weaponRangeSquares: Point[];
  blockedLineOfSightSquares?: Point[];
  visibleSquares?: Set<string>;
  exploredSquares?: Set<string>;
  combatAnim?: CombatAnimationState | null;
  suddenDeath: number;
  objectiveSquares?: Point[];
  relicCarrierId?: string | null;
  onSquareClick: (x: number, y: number) => void;
  onFighterClick: (id: string) => void;
}

function ProjectileAnim({ anim }: { anim: CombatAnimationState }) {
  const dx = anim.targetPoint.x - anim.attackerPoint.x;
  const dy = anim.targetPoint.y - anim.attackerPoint.y;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  if (!anim.isRanged) {
    return (
      <motion.div
        initial={{ x: 0, y: 0, opacity: 0, scale: 0.5, rotate: angle - 45 }}
        animate={{ x: `${dx * 50}%`, y: `${dy * 50}%`, opacity: [0, 1, 0], scale: 1.5, rotate: angle + 45 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="absolute inset-0 z-[60] pointer-events-none flex items-center justify-center text-4xl"
      >
        <span className="drop-shadow-[0_0_10px_rgba(255,255,255,0.8)] text-white/80">
          🗡️
        </span>
      </motion.div>
    );
  }

  let projectileNode = (
    <div 
      style={{ transform: `rotate(${angle}deg)` }} 
      className="w-1/2 h-2 bg-gray-400 rounded-full shadow-[0_0_5px_#9ca3af]" 
    />
  );
  
  if (anim.weaponId === 'bow') {
    projectileNode = (
      <div 
        style={{ transform: `rotate(${angle}deg)` }} 
        className="text-2xl drop-shadow-[0_0_5px_#fff]"
      >
        🏹
      </div>
    );
  } else if (anim.weaponId === 'sling') {
    projectileNode = (
      <div 
        className="w-3 h-3 bg-gray-600 rounded-full shadow-[0_0_8px_#4b5563]" 
      />
    );
  } else if (anim.weaponId === 'scorching_ray' || anim.weaponId === 'flying_embers') {
    projectileNode = (
      <div 
        style={{ transform: `rotate(${angle}deg)` }} 
        className="w-2/3 h-4 bg-orange-500 rounded-full blur-[2px] shadow-[0_0_20px_#f97316]" 
      />
    );
  } else if (anim.weaponId === 'fire_brand') {
    projectileNode = (
      <div 
        style={{ transform: `rotate(${angle}deg)` }} 
        className="w-1/2 h-3 bg-red-500 rounded-full shadow-[0_0_15px_#ef4444]" 
      />
    );
  }

  return (
    <motion.div
      initial={{ x: 0, y: 0, opacity: 1, scale: 0.5 }}
      animate={{ x: `${dx * 100}%`, y: `${dy * 100}%`, opacity: [1, 1, 0], scale: 1 }}
      transition={{ duration: 0.4, ease: "easeIn" }}
      className="absolute inset-0 z-[60] pointer-events-none flex items-center justify-center"
    >
      {projectileNode}
    </motion.div>
  );
}

function DiceOverlay({ anim }: { anim: CombatAnimationState }) {
  const [phase, setPhase] = useState<'atk_roll' | 'atk_bonus' | 'def_roll' | 'def_bonus' | 'result'>('atk_roll');

  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    
    setPhase('atk_roll');
    timers.push(setTimeout(() => setPhase('atk_bonus'), 500));
    timers.push(setTimeout(() => setPhase('def_roll'), 1200));
    timers.push(setTimeout(() => setPhase('def_bonus'), 1700));
    timers.push(setTimeout(() => setPhase('result'), 2400));
    
    return () => timers.forEach(clearTimeout);
  }, [anim]);

  return (
    <div className="absolute flex flex-col items-center justify-center -top-20 w-48 pointer-events-none z-[90]">
      <div className="bg-[#1a1814]/95 backdrop-blur-md rounded border-2 border-[#8a7a60] text-white shadow-2xl flex flex-col gap-1 text-sm font-bold min-w-full p-2">
        
        {/* Attack Row */}
        <div className="flex justify-between items-center text-red-400 h-6">
          <span className="uppercase tracking-widest text-xs">Atk</span>
          <div className="flex items-center gap-1 font-mono">
             {phase === 'atk_roll' ? (
                <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.2 }} className="text-lg inline-block">🎲</motion.span>
             ) : (
                <span>{anim.rawAttackRoll}</span>
             )}
             {(phase !== 'atk_roll' && anim.attackBonus > 0) && (
                <motion.span initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} className="text-xs text-red-300">+{anim.attackBonus}</motion.span>
             )}
             {(phase !== 'atk_roll' && phase !== 'atk_bonus') && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-1 text-white bg-red-600/60 px-1.5 rounded-sm">{anim.roll}</motion.span>
             )}
          </div>
        </div>

        {/* Defense Row */}
        {(phase === 'def_roll' || phase === 'def_bonus' || phase === 'result') && (
          <div className="flex justify-between items-center text-blue-400 border-t border-[#3d3329] pt-1 h-6">
            <span className="uppercase tracking-widest text-xs">Def</span>
            <div className="flex items-center gap-1 font-mono">
               {phase === 'def_roll' ? (
                  <motion.span animate={{ rotate: -360 }} transition={{ repeat: Infinity, duration: 0.2 }} className="text-lg inline-block">🎲</motion.span>
               ) : (
                  <span>{anim.rawDefenseRoll}</span>
               )}
               {(phase !== 'def_roll' && anim.defenseBonus > 0) && (
                  <motion.span initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} className="text-xs text-blue-300">+{anim.defenseBonus}</motion.span>
               )}
               {(phase === 'result') && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-1 text-white bg-blue-600/60 px-1.5 rounded-sm">{anim.targetNumber}</motion.span>
               )}
            </div>
          </div>
        )}

        {/* Result Row */}
        {phase === 'result' && (
          <motion.div 
            initial={{ scale: 0.8, opacity: 0, y: 5 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            className={`mt-1 py-1 rounded text-center text-sm uppercase tracking-widest font-black ${anim.hit ? 'bg-red-600 text-white' : 'bg-gray-600 text-gray-200'}`}
          >
            {anim.hit ? `HIT: ${anim.damage} DMG` : 'MISS'}
          </motion.div>
        )}

      </div>
    </div>
  );
}

export default function Grid({ 
  player1,
  player2,
  arena, 
  fighters, 
  selectedFighterId, 
  reachableSquares, 
  attackableEnemies,
  weaponRangeSquares,
  blockedLineOfSightSquares,
  visibleSquares,
  exploredSquares,
  combatAnim,
  suddenDeath,
  objectiveSquares,
  relicCarrierId,
  onSquareClick, 
  onFighterClick 
}: Props) {
  if (!arena) return <div>Loading...</div>;
  
  const selectedCellRef = useRef<HTMLDivElement>(null);
  const combatTargetRef = useRef<HTMLDivElement>(null);

  const selectedFighterPos = fighters.find(f => f.id === selectedFighterId);
  useEffect(() => {
    if (selectedCellRef.current && !combatAnim) {
      selectedCellRef.current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  }, [selectedFighterId, selectedFighterPos?.x, selectedFighterPos?.y, combatAnim]);

  useEffect(() => {
    if (combatAnim && combatTargetRef.current) {
      combatTargetRef.current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  }, [combatAnim]);

  const isObstacle = (x: number, y: number) => {
    return arena.obstacles.some(o => o.x === x && o.y === y);
  };

  const getFighterAt = (x: number, y: number) => {
    return fighters.find(f => f.x === x && f.y === y && f.currentHP > 0);
  };

  const getReachablePoint = (x: number, y: number) => {
    return reachableSquares.find(p => p.x === x && p.y === y);
  };

  const isWeaponRange = (x: number, y: number) => weaponRangeSquares.some(p => p.x === x && p.y === y);
  const isSpellRange = (x: number, y: number) => false;
  const isBlockedLoS = (x: number, y: number) => blockedLineOfSightSquares ? blockedLineOfSightSquares.some(p => p.x === x && p.y === y) : false;

  const getFillClass = (color: string) => {
    if (color === 'amber') return 'bg-amber-500/20';
    if (color === 'cyan') return 'bg-cyan-500/20';
    if (color === 'purple') return 'bg-purple-500/20';
    return '';
  };

  const getRingClass = (color: string) => {
    if (color === 'amber') return 'ring-2 ring-amber-500/50 ring-inset';
    if (color === 'cyan') return 'ring-2 ring-cyan-500/50 ring-inset';
    if (color === 'purple') return 'ring-2 ring-purple-500/50 ring-inset';
    return '';
  };

  const getPseudoRandomInt = (x: number, y: number, max: number) => {
    return ((x * 37 + y * 13) % max) + 1;
  };

  const getTerrainSvg = (x: number, y: number, classification?: string) => {
    if (!classification) return null;
    const variation = getPseudoRandomInt(x, y, 3);
    if (classification === 'rubble') {
       return (
           getAssetUrl(`assets/terrains/rubble_${variation}.png`) ? <img src={getAssetUrl(`assets/terrains/rubble_${variation}.png`)} className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none z-[13] mix-blend-overlay" alt="rubble" /> : null
         );
    }
    if (classification === 'undergrowth') {
       return (
           getAssetUrl(`assets/terrains/undergrowth_${variation}.png`) ? <img src={getAssetUrl(`assets/terrains/undergrowth_${variation}.png`)} className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none z-[13] mix-blend-overlay" alt="undergrowth" /> : null
         );
    }
    if (classification === 'debris') {
       return (
           getAssetUrl(`assets/terrains/debris_${variation}.png`) ? <img src={getAssetUrl(`assets/terrains/debris_${variation}.png`)} className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none z-[13] mix-blend-overlay" alt="debris" /> : null
         );
    }
    return null;
  };

  const getThemeFloorClass = (theme: string, x: number, y: number, terrainClassification?: string, isDeadZone?: boolean) => {
    if (terrainClassification === 'rubble' || isDeadZone) return 'bg-[#5c4d3d]';
    if (terrainClassification === 'undergrowth') return 'bg-[#064e3b] animate-forest-breathe';
    if (terrainClassification === 'debris') return 'bg-[#45403a]';

    const isAlternate = (x + y) % 2 === 0;
    switch (theme) {
      case 'ruined_chapel':
        return isAlternate ? 'bg-[#3f3f46]' : 'bg-[#27272a]';
      case 'dense_forest':
        return isAlternate ? 'bg-[#14532d]' : 'bg-[#052e16]';
      case 'ruined_village':
        return isAlternate ? 'bg-[#57534e]' : 'bg-[#292524]';
      default:
        return 'bg-fuchsia-500';
    }
  };

  const getThemeObstacleClass = (theme: string) => {
    switch (theme) {
      case 'ruined_chapel':
        return 'bg-[#18181b] shadow-[inset_0_0_20px_rgba(0,0,0,0.9)] border-4 border-black';
      case 'dense_forest':
        return 'bg-[#022c22] shadow-[inset_0_0_20px_rgba(0,0,0,0.9)] animate-forest-breathe border-4 border-black';
      case 'ruined_village':
        return 'bg-[#1c1917] shadow-[inset_0_0_20px_rgba(0,0,0,0.9)] animate-debris-shift border-4 border-black';
      default:
        return 'bg-fuchsia-500 shadow-inner border-4 border-black';
    }
  };

  const getObstacleTooltipName = (theme: string) => {
    switch (theme) {
      case 'ruined_chapel': return 'Crumbling Pillar';
      case 'dense_forest': return 'Thick Tree Trunk';
      case 'ruined_village': return 'Collapsed Wall';
      default: return 'Impassable Obstacle';
    }
  };

  const getThemeObstacleSvg = (x: number, y: number, theme: string) => {
    const variation = getPseudoRandomInt(x, y, 3);
    const baseClasses = "absolute inset-0 w-full h-full object-cover pointer-events-none z-20 brightness-125 contrast-125 drop-shadow-md";
    switch (theme) {
      case 'ruined_chapel':
        return (
           getAssetUrl(`assets/obstacles/ruined_chapel_${variation}.png`) ? <img src={getAssetUrl(`assets/obstacles/ruined_chapel_${variation}.png`)} className={baseClasses} alt="ruined chapel obstacle" /> : null
         );
      case 'dense_forest':
        return (
           getAssetUrl(`assets/obstacles/dense_forest_${variation}.png`) ? <img src={getAssetUrl(`assets/obstacles/dense_forest_${variation}.png`)} className={baseClasses} alt="dense forest obstacle" /> : null
         );
      case 'ruined_village':
        return (
           getAssetUrl(`assets/obstacles/ruined_village_${variation}.png`) ? <img src={getAssetUrl(`assets/obstacles/ruined_village_${variation}.png`)} className={baseClasses} alt="ruined village obstacle" /> : null
         );
      default:
        return null;
    }
  };

  const getGroundImageSvg = (x: number, y: number, theme: string) => {
    const variation = getPseudoRandomInt(x, y, 3);
    const themeName = theme || 'ruined_chapel';
    return (
         getAssetUrl(`assets/grounds/${themeName}_${variation}.png`) ? <img src={getAssetUrl(`assets/grounds/${themeName}_${variation}.png`)} className="absolute inset-0 w-full h-full object-cover opacity-60 pointer-events-none mix-blend-overlay z-0" alt={`${themeName} ground`} /> : null
      );
  };

  const cells = [];
  for (let y = 0; y < arena.gridHeight; y++) {
    for (let x = 0; x < arena.gridWidth; x++) {
      const key = `${x},${y}`;
      const isVisible = visibleSquares ? visibleSquares.has(key) : true;
      const isExplored = exploredSquares ? exploredSquares.has(key) : true;

      if (!isExplored) {
        cells.push(
          <div 
            key={key}
            className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 lg:w-14 lg:h-14 border border-[#3d3329]/20 bg-black flex items-center justify-center relative pointer-events-none shrink-0"
          />
        );
        continue;
      }

      const fighter = isVisible ? getFighterAt(x, y) : undefined;
      const obstacle = isObstacle(x, y);
      const terrain = arena.terrain?.find(t => t.x === x && t.y === y);
      const reachablePoint = isVisible ? getReachablePoint(x, y) : undefined;
      const reachable = !!reachablePoint;
      const isAttackable = isVisible && fighter && attackableEnemies.includes(fighter.id);
      const isSelected = fighter && fighter.id === selectedFighterId;
      
      const distToEdge = Math.min(
        x,
        y,
        arena.gridWidth - 1 - x,
        arena.gridHeight - 1 - y
      );
      const isDeadZone = suddenDeath >= 0 && distToEdge < suddenDeath;
      const isDangerZone = suddenDeath >= 0 && distToEdge === suddenDeath;

      const inWeaponRange = isVisible && isWeaponRange(x, y);
      const inSpellRange = isVisible && isSpellRange(x, y);
      const blockedLoS = isVisible && isBlockedLoS(x, y);
      const isObjectiveSquare = objectiveSquares?.some(p => p.x === x && p.y === y);

      let rangeFillClass = '';
      let rangeRingClass = '';

      const weaponColor = 'cyan';
      const spellColor = 'purple';

      if (inWeaponRange && inSpellRange) {
         rangeFillClass = getFillClass(spellColor);
         rangeRingClass = getRingClass(weaponColor);
      } else if (inWeaponRange) {
        rangeFillClass = getFillClass(weaponColor);
      } else if (inSpellRange) {
        rangeFillClass = getFillClass(spellColor);
      }

      let tooltipParts = [];
      if (obstacle) {
        tooltipParts.push(getObstacleTooltipName(arena.theme));
      } else {
        tooltipParts.push(`Terrain: ${terrain?.terrainClassification || 'floor'}`);
        tooltipParts.push(`Move Cost: ${terrain?.movementCost || 1}`);
        if (reachablePoint && reachablePoint.cost !== undefined) {
           tooltipParts.push(`Moves required: ${reachablePoint.cost}`);
        }
      }
      
      if (fighter) {
         const char = resolveCharacter(fighter.characterId);
         if (char) {
            tooltipParts.push(`Occupied by: ${char.name}`);
         }
      }
      const cellTitle = tooltipParts.join(" | ");

      cells.push(
        <div 
          key={key}
          title={cellTitle}
          ref={isSelected ? selectedCellRef : null}
          className={`
            w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 lg:w-14 lg:h-14 border border-[#3d3329]/50 flex items-center justify-center relative cursor-pointer shrink-0 group
            ${obstacle ? getThemeObstacleClass(arena.theme) : getThemeFloorClass(arena.theme, x, y, terrain?.terrainClassification, isDeadZone)}
            ${isSelected ? 'bg-blue-500/30 border border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.6)] z-10' : ''}
            transition-colors
          `}
          onClick={() => {
            if (fighter) {
              onFighterClick(fighter.id);
            } else if (!obstacle) {
              onSquareClick(x, y);
            }
          }}
        >
          {/* Ground Base Layer */}
          {getGroundImageSvg(x, y, arena.theme)}

          {/* Floor Hover Overlay */}
          {!obstacle && !fighter && (
            <div className="absolute inset-0 pointer-events-none group-hover:bg-white/5 z-0" />
          )}

          {/* Danger Zone Overlay */}
          {isDangerZone && (
            <div className="absolute inset-0 pointer-events-none bg-red-500/30 animate-pulse z-10" />
          )}

          {/* Reachable Highlight */}
          {reachable && !fighter && !obstacle && (
            <div className="absolute inset-0 pointer-events-none bg-blue-500/20 shadow-[inset_0_0_10px_rgba(59,130,246,0.4)] group-hover:bg-blue-500/30 z-0" />
          )}

          {/* Fog of War Overlay */}
          {!isVisible && (
            <div className="absolute inset-0 pointer-events-none bg-black/60 z-[50]" />
          )}

          {/* Range Overlay */}
          {(inWeaponRange || inSpellRange) && (
            <div className={`absolute inset-0 pointer-events-none ${rangeFillClass} ${rangeRingClass} z-[11]`} />
          )}

          {/* Objective Marker */}
          {isObjectiveSquare && (
            <div className="absolute inset-0 pointer-events-none bg-yellow-500/20 shadow-[inset_0_0_15px_rgba(234,179,8,0.5)] border border-yellow-500/50 z-[15] flex items-center justify-center">
              <span className="text-yellow-400 drop-shadow-[0_0_5px_rgba(234,179,8,1)] text-2xl opacity-60">
                 {objectiveSquares && objectiveSquares.length === 1 ? '💎' : '🏳️'}
              </span>
            </div>
          )}

          {/* Blocked LoS Overlay */}
          {blockedLoS && (
            <div className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.5),rgba(0,0,0,0.5)_5px,rgba(255,0,0,0.2)_5px,rgba(255,0,0,0.2)_10px)] z-[12]" />
          )}

          {/* Attackable Enemy Highlight (Layered on top) */}
          {isAttackable && (
            <div className="absolute inset-0 pointer-events-none bg-red-500/30 shadow-[inset_0_0_10px_rgba(239,68,68,0.5)] ring-2 ring-red-500 ring-inset z-[40] group-hover:bg-red-500/40" />
          )}

          {/* Terrain Decoration SVG */}
          {!obstacle && getTerrainSvg(x, y, terrain?.terrainClassification)}

          {/* Obstacle rendering */}
          {obstacle && getThemeObstacleSvg(x, y, arena.theme)}

          {/* Combat Animation Overlay */}
          {combatAnim && combatAnim.targetPoint.x === x && combatAnim.targetPoint.y === y && (
             <div ref={combatTargetRef} className="absolute inset-0 z-[90] flex items-center justify-center pointer-events-none">
                <DiceOverlay anim={combatAnim} />
             </div>
          )}

          {/* Projectile/Melee Animation Overlay */}
          {combatAnim && combatAnim.attackerPoint.x === x && combatAnim.attackerPoint.y === y && (
             <ProjectileAnim anim={combatAnim} />
          )}

          {/* Fighter rendering */}
          {fighter && (() => {
            const char = resolveCharacter(fighter.characterId);
            const totalHP = BASE_HP + (char?.toughness ?? 0);
            const healthPercent = fighter.currentHP / totalHP;

            const borderColorClass = ''; // using style instead
            const fColor = fighter.playerId === 1 ? player1.color : player2.color;
            const textColorClass = 'text-white'; // default to white for both
            const activationClass = fighter.hasActivatedThisRound ? 'opacity-60 brightness-50' : '';
            const iconUrl = (char as any)?.iconUrl;

            return (
              <motion.div
                layoutId={`fighter-${fighter.id}`}
                transition={{ duration: 0.4, ease: "easeInOut" }}
                className={`relative flex flex-col items-center justify-center pointer-events-none z-[30] ${activationClass}`}
                style={{ zIndex: 30 }}
              >
                <div
                  className={`
                    relative w-[32px] h-[32px] md:w-[44px] md:h-[44px] rounded-full overflow-hidden flex items-center justify-center font-bold text-sm md:text-lg shadow-[0_4px_8px_rgba(0,0,0,0.5)] border-2 md:border-3
                    bg-[#2a251e] ${textColorClass}
                  `}
                  style={{ borderColor: fColor }}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-xl md:text-2xl drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] leading-none z-20 pointer-events-none">
                    {(char as any)?.emoji}
                  </span>

                  {getAssetUrl(iconUrl) && <img src={getAssetUrl(iconUrl)} alt={char?.name} className="absolute inset-0 w-full h-full object-cover z-30 pointer-events-none" />}
                  
                  {/* Damage Shading */}
                  <div 
                    className="absolute top-0 left-0 right-0 bg-red-700/70 transition-all duration-300 ease-in-out z-40 pointer-events-none"
                    style={{ height: `${(1 - healthPercent) * 100}%` }}
                  />
                  
                  {/* Relic Carrier Badge */}
                  {relicCarrierId === fighter.id && (
                     <div className="absolute -top-2 -right-2 bg-yellow-500 text-black rounded-full w-5 h-5 md:w-6 md:h-6 flex items-center justify-center text-[10px] md:text-xs z-50 border border-yellow-200 shadow-md animate-pulse">
                        💎
                     </div>
                  )}
                </div>
              </motion.div>
            );
          })()}
        </div>
      );
    }
  }

  return (
    <div 
      className="inline-grid gap-0 bg-[#1a1814] border-4 border-[#3d3329] shadow-[0_0_50px_rgba(0,0,0,0.8)] mx-auto min-w-max min-h-max"
      style={{ gridTemplateColumns: `repeat(${arena.gridWidth}, max-content)` }}
    >
      {cells}
    </div>
  );
}
