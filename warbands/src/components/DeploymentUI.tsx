import { resolveCharacter } from "../utils/characters";
import { getAssetUrl } from '../utils/assets';
import { useState, useEffect } from 'react';
import { Player, Fighter, ArenaData, DeploymentStyle, Point } from '../types';
import charactersData from '../data/characters.json';
import { getDeploymentZones, autoPlaceFighters } from '../utils/deployment';
import SidePanel from './SidePanel';

interface Props {
  player1: Player;
  player2: Player;
  initialFighters: Fighter[];
  arena: ArenaData;
  deploymentStyle: DeploymentStyle;
  onReady: (fighters: Fighter[]) => void;
}

export default function DeploymentUI({
  player1,
  player2,
  initialFighters,
  arena,
  deploymentStyle,
  onReady
}: Props) {
  if (!arena) return <div>Loading...</div>;
  const [fighters, setFighters] = useState<Fighter[]>(initialFighters);
  const [currentPlayer, setCurrentPlayer] = useState<1 | 2>(1);
  const [selectedFighterId, setSelectedFighterId] = useState<string | null>(null);
  
  const [zones, setZones] = useState<{ p1Zone: Point[], p2Zone: Point[] }>({ p1Zone: [], p2Zone: [] });

  useEffect(() => {
    const p1Count = initialFighters.filter(f => f.playerId === 1).length;
    const p2Count = initialFighters.filter(f => f.playerId === 2).length;
    const z = getDeploymentZones(deploymentStyle, arena, p1Count, p2Count);
    setZones(z);
  }, [deploymentStyle, arena, initialFighters]);

  // Handle AI Auto-placement immediately when their turn starts
  useEffect(() => {
    const pInfo = currentPlayer === 1 ? player1 : player2;
    if (pInfo.type === 'ai') {
      const zone = currentPlayer === 1 ? zones.p1Zone : zones.p2Zone;
      if (zone.length > 0) {
        setFighters(prev => autoPlaceFighters(prev, currentPlayer, zone, prev));
        // End AI turn automatically
        if (currentPlayer === 1) setCurrentPlayer(2);
        // If AI is player 2, wait for "Ready" to be called? No, if both are done, ready.
      }
    }
  }, [currentPlayer, player1, player2, zones]);

  // Check if current player is done
  const myFighters = fighters.filter(f => f.playerId === currentPlayer);
  const myUnplaced = myFighters.filter(f => f.x === -1);
  const allPlaced = myUnplaced.length === 0;
  
  const isP1Done = fighters.filter(f => f.playerId === 1 && f.x === -1).length === 0;
  const isP2Done = fighters.filter(f => f.playerId === 2 && f.x === -1).length === 0;

  useEffect(() => {
    if (isP1Done && isP2Done) {
      // Both players placed their fighters.
      // We can transition automatically or wait for a button. 
      // The prompt says "Once both players are "Ready" (or auto-placed for AI), transition to the 'playing' phase"
    }
  }, [isP1Done, isP2Done]);

  const pInfo = currentPlayer === 1 ? player1 : player2;
  const isAI = pInfo.type === 'ai';

  const handleAutoPlace = () => {
    const zone = currentPlayer === 1 ? zones.p1Zone : zones.p2Zone;
    setFighters(prev => autoPlaceFighters(prev, currentPlayer, zone, prev));
  };

  const handleSquareClick = (x: number, y: number) => {
    if (isAI || !selectedFighterId) return;
    
    // check if it is in valid zone
    const zone = currentPlayer === 1 ? zones.p1Zone : zones.p2Zone;
    const isValid = zone.some(pt => pt.x === x && pt.y === y);
    if (!isValid) return;

    // check if occupied
    const occupied = fighters.some(f => f.x === x && f.y === y);
    if (occupied) return;

    setFighters(prev => prev.map(f => {
      if (f.id === selectedFighterId) {
        return { ...f, x, y };
      }
      return f;
    }));
    setSelectedFighterId(null);
  };

  const handleReady = () => {
    if (currentPlayer === 1) {
      setCurrentPlayer(2);
    } else {
      onReady(fighters);
    }
  };

  // If player 2 is AI, it auto-places. We need to automatically call onReady since it can't click the button.
  useEffect(() => {
    if (isP1Done && isP2Done && currentPlayer === 2 && player2.type === 'ai') {
      // Small timeout for visual feedback
      const t = setTimeout(() => onReady(fighters), 500);
      return () => clearTimeout(t);
    }
  }, [isP1Done, isP2Done, currentPlayer, player2.type, onReady, fighters]);


  const getThemeFloorClass = (theme: string, x: number, y: number, terrainClassification?: string) => {
    if (terrainClassification === 'rubble') return 'bg-[#3f3f46] animate-rubble-glow';
    if (terrainClassification === 'undergrowth') return 'bg-[#064e3b] animate-forest-breathe';
    if (terrainClassification === 'debris') return 'bg-[#292524] animate-debris-shift';

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
        return 'bg-[#18181b] shadow-[inset_0_0_20px_rgba(0,0,0,0.9)]';
      case 'dense_forest':
        return 'bg-[#022c22] shadow-[inset_0_0_20px_rgba(0,0,0,0.9)] animate-forest-breathe';
      case 'ruined_village':
        return 'bg-[#1c1917] shadow-[inset_0_0_20px_rgba(0,0,0,0.9)] animate-debris-shift';
      default:
        return 'bg-fuchsia-500 shadow-inner';
    }
  };

  const getThemeObstacleSvg = (theme: string) => {
    switch (theme) {
      case 'ruined_chapel':
        return (
           <svg className="absolute inset-0 w-full h-full opacity-50 pointer-events-none" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
             <rect x="15" y="15" width="70" height="70" fill="none" stroke="#71717a" strokeWidth="6"/>
             <rect x="25" y="25" width="50" height="50" fill="none" stroke="#52525b" strokeWidth="4"/>
             <line x1="15" y1="15" x2="85" y2="85" stroke="#3f3f46" strokeWidth="3"/>
             <line x1="85" y1="15" x2="15" y2="85" stroke="#3f3f46" strokeWidth="3"/>
           </svg>
        );
      case 'dense_forest':
        return (
           <svg className="absolute inset-0 w-full h-full opacity-60 pointer-events-none" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
             <circle cx="50" cy="50" r="35" fill="#064e3b" stroke="#22c55e" strokeWidth="3" strokeDasharray="8,4"/>
             <circle cx="40" cy="45" r="20" fill="#065f46" stroke="#16a34a" strokeWidth="2"/>
             <circle cx="60" cy="55" r="15" fill="#047857" stroke="#15803d" strokeWidth="2"/>
           </svg>
        );
      case 'ruined_village':
        return (
           <svg className="absolute inset-0 w-full h-full opacity-60 pointer-events-none" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
             <path d="M10 90 L90 90 L80 50 L60 50 L50 20 L20 20 Z" fill="#292524" stroke="#a1a1aa" strokeWidth="4"/>
             <line x1="20" y1="20" x2="20" y2="90" stroke="#78716c" strokeWidth="3"/>
             <line x1="10" y1="50" x2="80" y2="50" stroke="#78716c" strokeWidth="3"/>
           </svg>
        );
      default:
        return (
           <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
             <path d="M0 0L100 100M100 0L0 100" stroke="#d4c5a9" strokeWidth="2"/>
           </svg>
        );
    }
  };

  const activeZone = currentPlayer === 1 ? zones.p1Zone : zones.p2Zone;
  
  const cells = [];
  for (let y = 0; y < arena.gridHeight; y++) {
    for (let x = 0; x < arena.gridWidth; x++) {
      const obstacle = arena.obstacles.some(o => o.x === x && o.y === y);
      const fighter = fighters.find(f => f.x === x && f.y === y);
      const terrain = arena.terrain?.find(t => t.x === x && t.y === y);
      
      const inZone = activeZone.some(pt => pt.x === x && pt.y === y);
      const highlightZone = !isAI && inZone && !obstacle && !fighter && selectedFighterId;
      
      cells.push(
        <div
          key={`${x},${y}`}
          className={`
            w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 lg:w-14 lg:h-14 border border-[#3d3329]/50 flex items-center justify-center relative shrink-0 group
            ${obstacle ? getThemeObstacleClass(arena.theme) : getThemeFloorClass(arena.theme, x, y, terrain?.terrainClassification)}
            ${highlightZone ? 'bg-blue-500/20 shadow-[inset_0_0_10px_rgba(59,130,246,0.4)] cursor-pointer hover:bg-blue-500/30' : ''}
            ${!highlightZone && !obstacle ? '' : ''}
          `}
          onClick={() => handleSquareClick(x, y)}
        >
          {/* Floor Hover Overlay */}
          {!obstacle && !fighter && (
            <div className="absolute inset-0 pointer-events-none group-hover:bg-white/5 z-0" />
          )}

          {obstacle && getThemeObstacleSvg(arena.theme)}

          {fighter && (() => {
            const char = resolveCharacter(fighter.characterId);
            const iconUrl = (char as any)?.iconUrl;
            return (
              <div className={`
                relative overflow-hidden w-[32px] h-[32px] md:w-[44px] md:h-[44px] rounded-full flex items-center justify-center font-bold text-sm md:text-lg text-shadow-md shadow-[0_4px_8px_rgba(0,0,0,0.5)] border-2 md:border-3 cursor-pointer
                ${fighter.playerId === 1 ? 'bg-[#8a7a60] text-white' : 'bg-[#4a4a4a] text-[#d4c5a9]'}
              `}
              style={{ borderColor: fighter.playerId === 1 ? player1.color : player2.color }}
              onClick={(e) => {
                if (!isAI && fighter.playerId === currentPlayer) {
                  e.stopPropagation();
                  // Return to unplaced
                  setFighters(prev => prev.map(f => f.id === fighter.id ? { ...f, x: -1, y: -1 } : f));
                }
              }}
              >
                <span className="absolute inset-0 flex items-center justify-center leading-none text-xl md:text-2xl z-20">
                  {(char as any)?.emoji}
                </span>
                {getAssetUrl(iconUrl) && <img src={getAssetUrl(iconUrl)} alt={char?.name} className="absolute inset-0 w-full h-full object-cover z-30" />}
              </div>
            );
          })()}
        </div>
      );
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 w-full animate-in fade-in duration-500">
      
      {/* Side Panel */}
      <div className="w-full lg:w-[320px] bg-[#1a1814] border-2 border-[#3d3329] flex flex-col shadow-2xl shrink-0 p-4">
        <h2 className="text-xl font-bold mb-4 uppercase tracking-widest text-[#d4c5a9] border-b border-[#3d3329] pb-2">
          Deployment
        </h2>
        
        {!isAI ? (
          <div className="flex flex-col flex-1">
            <h3 className="text-md font-bold mb-4" style={{ color: currentPlayer === 1 ? player1.color : player2.color }}>
              {currentPlayer === 1 ? player1.name : player2.name} Turn
            </h3>
            
            <p className="text-sm text-[#8a7a60] mb-4">
              Select a fighter, then click a highlighted square to place them.
            </p>
            
            <div className="space-y-2 flex-1">
              {myFighters.map(f => {
                const char = resolveCharacter(f.characterId);
                const isSelected = f.id === selectedFighterId;
                const isPlaced = f.x !== -1;
                return (
                  <button
                    key={f.id}
                    onClick={() => {
                      if (!isPlaced) setSelectedFighterId(f.id);
                    }}
                    disabled={isPlaced}
                    className={`w-full text-left p-2 border-l-4 flex justify-between items-center transition-colors
                      ${isPlaced ? 'bg-[#2a251e] opacity-50 cursor-not-allowed' : 'bg-[#1a1814] hover:bg-[#2a251e]'}
                      ${isSelected ? 'bg-[#2a251e] ring-1 ring-blue-500' : ''}
                    `}
                    style={{ borderLeftColor: currentPlayer === 1 ? player1.color : player2.color }}
                  >
                    <span className="font-bold">{char?.name}</span>
                    {isPlaced && <span className="text-xs uppercase tracking-widest text-[#8a7a60]">Placed</span>}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 mt-4">
              <button 
                onClick={handleAutoPlace}
                disabled={allPlaced}
                className="w-full bg-[#2a251e] hover:bg-[#3d3329] text-[#d4c5a9] font-bold py-2 border border-[#5c4d3d] uppercase tracking-widest text-xs disabled:opacity-50"
              >
                Auto-Place Remaining
              </button>
              
              <button
                onClick={handleReady}
                disabled={!allPlaced}
                className="w-full bg-[#8a7a60] hover:bg-[#a39478] text-[#1a1814] font-bold py-3 px-4 rounded-sm disabled:opacity-50 transition-colors uppercase tracking-widest shadow-lg"
              >
                {currentPlayer === 1 && !isP2Done ? 'End Deployment' : 'Ready for Battle'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[#8a7a60] italic animate-pulse">AI is deploying...</p>
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 bg-[#121212] overflow-auto p-4">
        <div className="w-max mx-auto">
          <div 
            className="inline-grid gap-0 bg-[#1a1814] border-4 border-[#3d3329] shadow-[0_0_50px_rgba(0,0,0,0.8)] relative min-w-max min-h-max"
            style={{ gridTemplateColumns: `repeat(${arena.gridWidth}, max-content)` }}
          >
            {cells}
          </div>
        </div>
      </div>
      
      {/* Selected Fighter Details Side Panel */}
      <div className="w-full lg:w-[320px] shrink-0 pointer-events-auto h-[400px] lg:h-auto">
         <SidePanel 
           fighter={fighters.find(f => f.id === selectedFighterId) || null}
           player={fighters.find(f => f.id === selectedFighterId) ? (fighters.find(f => f.id === selectedFighterId)?.playerId === 1 ? player1 : player2) : null}
           onEndActivation={() => {}}
           isFightersTurn={false}
           canEndActivation={false}
         />
      </div>

    </div>
  );
}
