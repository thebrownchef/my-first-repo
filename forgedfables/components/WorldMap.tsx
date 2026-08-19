
import React, { useState, useMemo } from 'react';
import { Player, WorldLocation } from '../types';

interface WorldMapProps {
  locations: WorldLocation[];
  players: Player[];
  onClose: () => void;
}

const getCoordinates = (index: number, total: number) => {
  // Index 0 is assumed to be the Hub (Center)
  if (index === 0) return { x: 50, y: 50 }; // Center aligned
  
  // Distribute remaining (total - 1) nodes in a circle
  const remaining = total - 1;
  const effectiveIndex = index - 1;
  const angleStep = (2 * Math.PI) / remaining;
  const startAngle = -Math.PI / 2; // Start from top (12 o'clock)
  const angle = startAngle + (effectiveIndex * angleStep);
  
  // Radius adjusted to keep tooltip inside container
  const radius = 25; // % distance from center (Reduced from 30)
  return {
    x: 50 + radius * Math.cos(angle),
    y: 50 + radius * Math.sin(angle)
  };
};

export const WorldMap: React.FC<WorldMapProps> = ({ locations, players, onClose }) => {
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);

  // 1. Calculate Node Positions
  // We explicitly try to find the "Hub" (ID 0) and put it first for the layout algo
  const sortedLocations = useMemo(() => {
    // Robust check for name existence before toLowerCase
    const hub = locations.find(l => l.id === '0' || (l.name && l.name.toLowerCase().includes('hub')));
    const others = locations.filter(l => l !== hub);
    return hub ? [hub, ...others] : locations;
  }, [locations]);

  const nodes = useMemo(() => {
      return sortedLocations.map((loc, idx) => ({
          ...loc,
          pos: getCoordinates(idx, sortedLocations.length)
      }));
  }, [sortedLocations]);

  // 2. Calculate Connections (Lines)
  const connections = useMemo(() => {
      const lines: { x1: number, y1: number, x2: number, y2: number, key: string }[] = [];
      const processedPair = new Set<string>();

      nodes.forEach(nodeA => {
          if (!nodeA.connectedLocationIds) return;
          
          nodeA.connectedLocationIds.forEach(targetId => {
              const nodeB = nodes.find(n => n.id === targetId);
              if (nodeB) {
                  // Create a unique key for the pair to avoid drawing line A-B and B-A
                  const pairKey = [nodeA.id, nodeB.id].sort().join('-');
                  if (!processedPair.has(pairKey)) {
                      lines.push({
                          x1: nodeA.pos.x,
                          y1: nodeA.pos.y,
                          x2: nodeB.pos.x,
                          y2: nodeB.pos.y,
                          key: pairKey
                      });
                      processedPair.add(pairKey);
                  }
              }
          });
      });
      return lines;
  }, [nodes]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="relative w-full max-w-7xl h-[90vh] bg-slate-950 border-2 border-amber-600/50 rounded-lg shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden flex" onClick={e => e.stopPropagation()}>
        
        {/* Map Area (Full Width) */}
        <div className="flex-1 relative bg-slate-950 overflow-hidden group/map">
           {/* Background Textures */}
           <div className="absolute inset-0 opacity-10 pointer-events-none" 
             style={{ 
                backgroundImage: 'radial-gradient(circle at center, #94a3b8 1px, transparent 1px)', 
                backgroundSize: '40px 40px' 
             }}></div>
           
           <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,6,23,0.8)_100%)] pointer-events-none"></div>
           
           {/* Header */}
           <div className="absolute top-8 left-8 z-10 pointer-events-none select-none">
             <h2 className="text-6xl font-display text-slate-800 uppercase tracking-[0.2em] font-bold drop-shadow-md">World Map</h2>
             <p className="text-slate-600 font-mono text-xs mt-2 ml-1 tracking-widest">TOPOLOGY: DYNAMIC GRAPH</p>
           </div>
           
           <button onClick={onClose} className="absolute top-6 right-6 z-30 text-slate-400 hover:text-white transition-colors bg-black/20 hover:bg-black/50 p-2 rounded-full cursor-pointer">
              <span className="text-3xl font-display leading-none block w-8 h-8 text-center">✕</span>
           </button>

           {/* Connections Layer (SVG) */}
           <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
               {connections.map(line => (
                   <line 
                     key={line.key}
                     x1={`${line.x1}%`} y1={`${line.y1}%`} 
                     x2={`${line.x2}%`} y2={`${line.y2}%`} 
                     stroke="#475569" 
                     strokeWidth="2" 
                     strokeDasharray="5,5"
                     className="opacity-50"
                   />
               ))}
           </svg>

           {/* Locations Nodes */}
           {nodes.map(loc => {
              const isActive = activeLocationId === loc.id;
              const hasPlayers = loc.playerIds.length > 0;
              const isHub = loc.id === '0' || (loc.name && loc.name.toLowerCase().includes('hub'));
              
              // Determine if node is in top half to flip tooltip
              const isTopHalf = loc.pos.y < 50;

              // Sanitized name for display
              let displayName = loc.name || "Unknown";
              // If name accidentally contains metadata, try to clean it for display
              if (displayName.includes('ID:')) displayName = displayName.split('ID:')[0];
              if (displayName.includes('CHARACTER:')) displayName = displayName.split('CHARACTER:')[0];
              
              return (
                <div 
                  key={loc.id}
                  className={`absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-500 ${isActive ? 'z-40 scale-110' : 'z-20 scale-100 hover:scale-105'}`}
                  style={{ left: `${loc.pos.x}%`, top: `${loc.pos.y}%` }}
                  onMouseEnter={() => setActiveLocationId(loc.id)}
                  onMouseLeave={() => setActiveLocationId(null)}
                >
                    {/* Ripple Effect for Hub or Active */}
                    {(isHub || hasPlayers) && (
                        <div className="absolute inset-0 rounded-full animate-ping opacity-20 bg-amber-500"></div>
                    )}
                    
                    {/* Node Circle */}
                    <div className={`
                        relative w-20 h-20 rounded-full border-4 flex flex-col items-center justify-center p-1 text-center shadow-[0_0_30px_rgba(0,0,0,0.5)] backdrop-blur-md transition-colors overflow-hidden
                        ${isActive ? 'bg-slate-800 border-amber-400' : 'bg-slate-900 border-slate-600'}
                        ${hasPlayers ? 'border-amber-500/70' : ''}
                    `}>
                        <div className="text-[8px] text-slate-500 uppercase tracking-widest mb-0.5">{isHub ? 'NEXUS' : 'ZONE'}</div>
                        <div className={`font-display font-bold leading-tight ${isActive ? 'text-white' : 'text-slate-300'} text-[10px] w-full px-1 overflow-hidden`}>
                            {displayName}
                        </div>
                        
                        {/* Player Avatars in Location */}
                        {hasPlayers && (
                            <div className="absolute -bottom-3 flex -space-x-2 z-50">
                                {loc.playerIds.map(pid => {
                                    const p = players.find(pl => pl.id === pid);
                                    if (!p) return null;
                                    return (
                                        <div key={pid} className="w-6 h-6 rounded-full border border-slate-900 overflow-hidden bg-slate-800 shadow-sm" title={p.name}>
                                            <img src={p.avatarUrl} className="w-full h-full object-cover" />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    
                    {/* Tooltip Description - Dynamic Placement */}
                    <div className={`
                        absolute left-1/2 -translate-x-1/2 w-72 bg-black/95 p-4 rounded-lg border border-slate-600 text-center pointer-events-none transition-all duration-300 z-50 shadow-2xl
                        ${isTopHalf ? 'top-full mt-4' : 'bottom-full mb-4'}
                        ${isActive ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
                    `}>
                        <div className="text-amber-500 font-bold font-display mb-1 text-lg leading-tight">{displayName}</div>
                        <p className="text-sm text-slate-300 font-serif leading-relaxed line-clamp-6">{loc.description}</p>
                        {loc.connectedLocationIds && loc.connectedLocationIds.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
                                Connected
                            </div>
                        )}
                        {/* Arrow */}
                        <div className={`absolute left-1/2 -translate-x-1/2 border-8 border-transparent ${isTopHalf ? 'bottom-full border-b-black/95' : 'top-full border-t-black/95'}`}></div>
                    </div>
                </div>
              );
           })}
           
        </div>
      </div>
    </div>
  );
};
