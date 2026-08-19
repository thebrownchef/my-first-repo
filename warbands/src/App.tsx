import { AppErrorBoundary } from "./AppErrorBoundary";
import { useState } from 'react';
import { GamePhase, Player, Fighter, ScenarioState, ScenarioType } from './types';
import WarbandBuilder from './components/WarbandBuilder';
import DeploymentUI from './components/DeploymentUI';
import GameUI from './components/GameUI';
import arenasData from './data/arenas.json';
import { DeploymentStyle } from './types';
import { generateScenario } from './utils/scenarios';

export default function App() {
  const [phase, setPhase] = useState<GamePhase>('builder');
  
  const [player1, setPlayer1] = useState<Player>({ id: 1, type: 'human', color: '#3b82f6', name: 'Team 1' });
  const [player2, setPlayer2] = useState<Player>({ id: 2, type: 'ai', color: '#eab308', name: 'Team 2' });
  
  const [fighters, setFighters] = useState<Fighter[]>([]);
  const [activeArena, setActiveArena] = useState<any>(arenasData[0]);
  const [deploymentStyle, setDeploymentStyle] = useState<DeploymentStyle>('corners');
  const [scenario, setScenario] = useState<ScenarioState | null>(null);

  const handleStartDeployment = async (roster: Fighter[], selectedArena: any, style: DeploymentStyle, scenarioType: ScenarioType | 'random') => {
    console.log("selectedArena:", selectedArena); setActiveArena(selectedArena);
    setDeploymentStyle(style);
    
    const newScenario = generateScenario(scenarioType, selectedArena);
    setScenario(newScenario);
    
    if (style === 'random') {
      const { getDeploymentZones, autoPlaceFighters } = await import('./utils/deployment');
      const p1Count = roster.filter(f => f.playerId === 1).length;
      const p2Count = roster.filter(f => f.playerId === 2).length;
      const { p1Zone, p2Zone } = getDeploymentZones(style, selectedArena, p1Count, p2Count);
      let placedFighters = autoPlaceFighters(roster, 1, p1Zone, roster);
      placedFighters = autoPlaceFighters(placedFighters, 2, p2Zone, placedFighters);
      setFighters(placedFighters);
      setPhase('playing');
    } else {
      setFighters(roster);
      setPhase('deployment');
    }
  };

  const handleStartGame = (deployedFighters: Fighter[]) => {
    setFighters(deployedFighters);
    setPhase('playing');
  };

  const handleBackToMenu = () => {
    setPhase('builder');
    setFighters([]);
  };

  return (
    <AppErrorBoundary><div className="h-screen bg-[#121212] text-[#d4c5a9] font-serif selection:bg-[#3d3329] flex flex-col">
      <header className="h-16 bg-[#1a1814] border-b-2 border-[#3d3329] flex items-center justify-between px-8 shadow-2xl relative z-10 shrink-0">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest text-[#8a7a60]">Engine V1.0</span>
          <span className="text-lg font-bold text-[#d4c5a9] tracking-tight">WARBANDS</span>
        </div>
      </header>
      
      <main className="flex-1 min-h-0 flex flex-col p-4 md:p-8 max-w-7xl mx-auto w-full">
        {phase === 'builder' && (
          <WarbandBuilder 
            player1={player1} 
            setPlayer1={setPlayer1}
            player2={player2}
            setPlayer2={setPlayer2}
            onStart={handleStartDeployment} 
          />
        )}
        
        {phase === 'deployment' && (
          <DeploymentUI 
            player1={player1}
            player2={player2}
            initialFighters={fighters}
            arena={activeArena}
            deploymentStyle={deploymentStyle}
            onReady={handleStartGame}
          />
        )}
        
        {phase === 'playing' && (
          <GameUI 
            player1={player1}
            player2={player2}
            initialFighters={fighters}
            arena={activeArena}
            scenario={scenario}
            onBackToMenu={handleBackToMenu}
          />
        )}
      </main>
    </div>
    </AppErrorBoundary>
  );
}
