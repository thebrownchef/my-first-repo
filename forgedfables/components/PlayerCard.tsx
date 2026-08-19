
import React from 'react';
import { Player } from '../types';

interface PlayerCardProps {
  player: Player;
  isActive: boolean;
  compact?: boolean;
  onClick?: () => void;
}

export const PlayerCard: React.FC<PlayerCardProps> = ({ player, isActive, compact = false, onClick }) => {
  // Defensive check: ensure c is a string
  const isDead = player.conditions?.some(c => 
    c && typeof c === 'string' && (c.toLowerCase().includes('dead') || c.toLowerCase().includes('deceased'))
  );

  return (
    <div 
      onClick={onClick}
      className={`
        relative overflow-hidden rounded-xl border-2 transition-all duration-300 flex-shrink-0
        ${isActive 
          ? `border-${player.color}-500 shadow-[0_0_20px_rgba(139,92,246,0.3)] bg-gray-800` 
          : 'border-gray-700 bg-gray-900/50 opacity-80'}
        ${compact ? 'p-2' : 'p-4'}
        ${onClick ? 'cursor-pointer hover:scale-[1.02] hover:bg-gray-800' : ''}
        ${isDead ? 'grayscale opacity-60' : ''}
      `}
      style={{ borderColor: isActive ? player.color : undefined }}
    >
      <div className="flex items-center gap-3">
        <div className={`
          relative overflow-hidden rounded-full bg-gray-700 flex-shrink-0
          ${compact ? 'w-10 h-10' : 'w-16 h-16'}
        `}>
          <img 
            src={player.avatarUrl || `https://picsum.photos/seed/${player.avatarSeed}/200`} 
            alt={player.name}
            className="w-full h-full object-cover"
          />
          {/* Dead Overlay */}
          {isDead && (
             <div className="absolute inset-0 bg-black/60 flex items-center justify-center font-bold text-red-500 text-2xl rotate-12 border-2 border-red-900 rounded-full">
                 ☠
             </div>
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex flex-col justify-start">
            {!compact && <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">{player.playerName}</div>}
            <div className="flex justify-between items-start">
                <h3 className={`font-display font-bold text-gray-100 truncate ${compact ? 'text-sm' : 'text-lg'} leading-none ${isDead ? 'line-through text-gray-500' : ''}`}>
                {player.name}
                </h3>
            </div>
          </div>
          {!compact && (
            <div className="mt-1 flex flex-col gap-1 w-full overflow-hidden">
                <p className="text-xs text-gray-400 font-serif italic line-clamp-2">
                Quest: {player.goal}
                </p>
                <div className="flex items-center bg-black/40 px-2 py-0.5 rounded-full border border-gray-600/50 w-max mt-1 mb-1">
                    <span className="text-amber-400 text-[9px] font-bold uppercase tracking-wider mr-1.5">Quest Progress</span>
                    <span className="text-amber-100 font-display font-bold text-xs">{player.score}</span>
                </div>
                {/* Conditions Tags */}
                {player.conditions && player.conditions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {player.conditions.map((cond, idx) => {
                             if (!cond || typeof cond !== 'string') return null;
                             return (
                                <span key={idx} className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide border ${
                                    cond.toLowerCase().includes('dead') ? 'bg-red-950 text-red-400 border-red-800' :
                                    cond.toLowerCase().includes('injured') ? 'bg-orange-950 text-orange-400 border-orange-800' :
                                    'bg-blue-950 text-blue-300 border-blue-800'
                                }`}>
                                    {cond}
                                </span>
                             );
                        })}
                    </div>
                )}
            </div>
          )}
        </div>
        
        {isActive && !isDead && (
          <div className="absolute top-2 right-2 animate-pulse">
            <span className="flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
