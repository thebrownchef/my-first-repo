import { resolveCharacter } from "../utils/characters";
import { useState, useEffect, useRef, useMemo } from 'react';
import { ArenaData, Player, Fighter, Point, WeaponData, ScenarioState } from '../types';
import Grid from './Grid';
import SidePanel from './SidePanel';
import Log from './Log';
import charactersData from '../data/characters.json';
import weaponsDataJson from '../data/weapons.json';
import { getDistance, getReachableSquares, findPath, hasLineOfSight } from '../utils/grid';

import { calculateAITurn } from '../utils/ai';
import { resolveAttack } from '../utils/combat';
import PostMatchProgression from './PostMatchProgression';

const weaponsData = weaponsDataJson as WeaponData[];

interface Props {
  player1: Player;
  player2: Player;
  initialFighters: Fighter[];
  arena: ArenaData;
  scenario?: ScenarioState | null;
  onBackToMenu: () => void;
}

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
  weaponId: string;
  rawAttackRoll: number;
  attackBonus: number;
  rawDefenseRoll: number;
  defenseBonus: number;
}

export default function GameUI({ player1, player2, initialFighters, arena, scenario: initialScenario, onBackToMenu }: Props) {
  const [fighters, setFighters] = useState<Fighter[]>(initialFighters);
  const [scenario, setScenario] = useState<ScenarioState | null>(initialScenario || null);
  const [activePlayerId, setActivePlayerId] = useState<1 | 2>(1);
  const [round, setRound] = useState(1);
  const [selectedFighterId, setSelectedFighterId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [gameOver, setGameOver] = useState<boolean>(false);
  const [winner, setWinner] = useState<number | null>(null);
  const [autoEndTurn, setAutoEndTurn] = useState<boolean>(true);
  const [isAITurnExecuting, setIsAITurnExecuting] = useState<boolean>(false);
  const [executingFighterId, setExecutingFighterId] = useState<string | null>(null);
  const [aiFocusTargetId, setAiFocusTargetId] = useState<string | null>(null);
  const [combatAnim, setCombatAnim] = useState<CombatAnimationState | null>(null);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [suddenDeath, setSuddenDeath] = useState<number>(-1);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, msg]);
  };

  const getPlayer = (id: 1 | 2) => id === 1 ? player1 : player2;
  const activePlayer = getPlayer(activePlayerId);

  // Check win condition
  useEffect(() => {
    let nextFighters = [...fighters];
    let mutated = false;
    
    if (suddenDeath >= 0) {
      nextFighters = nextFighters.map(f => {
        if (f.currentHP > 0) {
          const distToEdge = Math.min(
            f.x,
            f.y,
            arena.gridWidth - 1 - f.x,
            arena.gridHeight - 1 - f.y
          );
          if (distToEdge < suddenDeath) {
            mutated = true;
            const char = resolveCharacter(f.characterId);
            addLog(`${(char as any)?.emoji} ${char?.name} is consumed by sudden death!`);
            return { ...f, currentHP: 0 };
          }
        }
        return f;
      });
    }

    if (mutated) {
      setFighters(nextFighters);
      return; 
    }

    const p1Alive = nextFighters.some(f => f.playerId === 1 && f.currentHP > 0);
    const p2Alive = nextFighters.some(f => f.playerId === 2 && f.currentHP > 0);
    
    if (!p1Alive || !p2Alive) {
      setGameOver(true);
      if (p1Alive && !p2Alive) setWinner(1);
      else if (!p1Alive && p2Alive) setWinner(2);
      else setWinner(0); // Draw
      return;
    }

    if (scenario) {
      if (scenario.type === 'breakthrough') {
        const p1TargetY = arena.spawnPointsP2[0]?.y > arena.gridHeight / 2 ? arena.gridHeight - 1 : 0;
        const p2TargetY = arena.spawnPointsP1[0]?.y > arena.gridHeight / 2 ? arena.gridHeight - 1 : 0;
        
        for (const f of nextFighters) {
          if (f.currentHP > 0) {
            if (f.playerId === 1 && f.y === p1TargetY) {
              setGameOver(true);
              setWinner(1);
              return;
            }
            if (f.playerId === 2 && f.y === p2TargetY) {
              setGameOver(true);
              setWinner(2);
              return;
            }
          }
        }
      } else if (scenario.type === 'relic' && scenario.relicCarrierId) {
        const carrier = nextFighters.find(f => f.id === scenario.relicCarrierId);
        if (carrier && carrier.currentHP > 0) {
           const targetY = carrier.playerId === 1 ? (arena.spawnPointsP1[0]?.y > arena.gridHeight / 2 ? arena.gridHeight - 1 : 0) : (arena.spawnPointsP2[0]?.y > arena.gridHeight / 2 ? arena.gridHeight - 1 : 0);
           if (carrier.y === targetY) {
              setGameOver(true);
              setWinner(carrier.playerId);
              return;
           }
        }
      }
    }
  }, [fighters, suddenDeath, arena.gridWidth, arena.gridHeight, scenario, arena.spawnPointsP1, arena.spawnPointsP2]);

  // Handle turn cycle & AI
  useEffect(() => {
    if (gameOver) return;

    // Check if round is over
    const activeFighters = fighters.filter(f => f.currentHP > 0);
    if (activeFighters.every(f => f.hasActivatedThisRound)) {
      addLog(`--- Round ${round} ends ---`);
      
      let matchEnded = false;
      if (scenario) {
        if (scenario.type === 'control_point' && scenario.controlZone) {
          let p1Count = 0;
          let p2Count = 0;
          activeFighters.forEach(f => {
            if (scenario.controlZone!.some(p => p.x === f.x && p.y === f.y)) {
              if (f.playerId === 1) p1Count++;
              else p2Count++;
            }
          });
          
          let p1Score = scenario.controlScoreP1 || 0;
          let p2Score = scenario.controlScoreP2 || 0;
          
          if (p1Count > p2Count) {
            p1Score++;
            addLog(`Control Point: ${player1.name} gains 1 point!`);
          } else if (p2Count > p1Count) {
            p2Score++;
            addLog(`Control Point: ${player2.name} gains 1 point!`);
          } else if (p1Count > 0 && p2Count > 0) {
            addLog(`Control Point: Contested (no points awarded).`);
          }

          setScenario(prev => prev ? { ...prev, controlScoreP1: p1Score, controlScoreP2: p2Score } : prev);
          
          if (p1Score >= (scenario.controlScoreTarget || 3)) {
            setGameOver(true);
            setWinner(1);
            matchEnded = true;
          } else if (p2Score >= (scenario.controlScoreTarget || 3)) {
            setGameOver(true);
            setWinner(2);
            matchEnded = true;
          }
        }
        
        if (!matchEnded && round >= scenario.roundLimit) {
          addLog(`Round limit reached! Deciding by tiebreak...`);
          setGameOver(true);
          
          const sorted = [...activeFighters].sort((a, b) => {
            const killsA = a.kills || 0;
            const killsB = b.kills || 0;
            if (killsA !== killsB) return killsB - killsA;
            const dmgA = a.damageDealt || 0;
            const dmgB = b.damageDealt || 0;
            if (dmgA !== dmgB) return dmgB - dmgA;
            return b.currentHP - a.currentHP;
          });
          
          if (sorted.length > 0) {
            setWinner(sorted[0].playerId);
          } else {
            setWinner(0);
          }
          matchEnded = true;
        }
      }
      
      if (matchEnded) return;

      setRound(prev => prev + 1);

      const p1AliveCount = fighters.filter(f => f.playerId === 1 && f.currentHP > 0).length;
      const p2AliveCount = fighters.filter(f => f.playerId === 2 && f.currentHP > 0).length;
      if (p1AliveCount === 1 || p2AliveCount === 1) {
        setSuddenDeath(prev => {
          const next = prev + 1;
          if (next === 0) addLog("Sudden Death begins!");
          else addLog(`Sudden Death boundary closes in (Danger Zone: ${next})!`);
          return next;
        });
      }

      setFighters(prev => prev.map(f => ({ 
        ...f, 
        hasActivatedThisRound: false, 
        distanceMovedThisTurn: 0, 
        hasAttackedThisTurn: false
      })));
      setActivePlayerId(1); // Usually P1 goes first, or could be alternating. Let's say P1 always starts round.
      setSelectedFighterId(null);
      return;
    }

    // Check if active player has any unactivated fighters left
    const playerUnactivatedFighters = activeFighters.filter(f => f.playerId === activePlayerId && !f.hasActivatedThisRound);
    if (playerUnactivatedFighters.length === 0) {
      // Pass turn to other player
      setActivePlayerId(activePlayerId === 1 ? 2 : 1);
      setSelectedFighterId(null);
      return;
    }

    if (!selectedFighterId && playerUnactivatedFighters.length > 0) {
      setSelectedFighterId(playerUnactivatedFighters[0].id);
    }

    // AI Turn
    if (activePlayer.type === 'ai' && !isAITurnExecuting) {
      setIsAITurnExecuting(true);
      // Pick a random unactivated fighter
      const aiFighter = playerUnactivatedFighters[Math.floor(Math.random() * playerUnactivatedFighters.length)];
      setExecutingFighterId(aiFighter.id);

      // We need a slight delay so it's not instant and human can see
      const timer = setTimeout(() => {
        executeAITurn(aiFighter);
      }, 1000);
      // Do not clear the timeout here, as setting isAITurnExecuting causes a re-render
      // which would immediately clear the timeout before it executes.
    }
  }, [activePlayerId, round, fighters, gameOver, isAITurnExecuting]);

  // (moved useEffect below)

  const effectiveObstacles = useMemo(() => {
    if (suddenDeath < 0) return arena.obstacles;
    const deadZones: Point[] = [];
    for (let x = 0; x < arena.gridWidth; x++) {
      for (let y = 0; y < arena.gridHeight; y++) {
        const distToEdge = Math.min(
          x,
          y,
          arena.gridWidth - 1 - x,
          arena.gridHeight - 1 - y
        );
        if (distToEdge < suddenDeath) {
           deadZones.push({x, y});
        }
      }
    }
    return [...arena.obstacles, ...deadZones];
  }, [arena.obstacles, suddenDeath, arena.gridWidth, arena.gridHeight]);

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const animateMovement = async (fighterId: string, path: Point[], totalCost: number) => {
    setIsAnimating(true);
    for (const step of path) {
      setFighters(prev => prev.map(f => f.id === fighterId ? { ...f, x: step.x, y: step.y } : f));
      await delay(400); // Matches motion.div transition duration
    }
    setFighters(prev => prev.map(f => f.id === fighterId ? { ...f, distanceMovedThisTurn: f.distanceMovedThisTurn + totalCost } : f));
    setIsAnimating(false);
  };

  const executeAITurn = async (initialAiFighter: Fighter) => {
    try {
      await delay(1000); // Give player time to digest before AI acts
      const aiFighterId = initialAiFighter.id;
      let aiChar = resolveCharacter(initialAiFighter.characterId)!;
      
      // We start with the fighters from the closure.
      // Since no other updates happen during the 1s delay, this is up-to-date.
      let currentFighters = [...fighters];
      const currentAiFighter = currentFighters.find(f => f.id === aiFighterId)!;
      
      const turn = calculateAITurn(currentAiFighter, currentFighters, { ...arena, obstacles: effectiveObstacles }, suddenDeath);

      if (!turn) {
        setFighters(prev => prev.map(f => f.id === aiFighterId ? { ...f, hasActivatedThisRound: true } : f));
        setSelectedFighterId(null);
        setExecutingFighterId(null);
        setActivePlayerId(activePlayerId === 1 ? 2 : 1);
        return;
      }

      // Move 1
      if (turn.move1) {
        addLog(`${player2.name}'s ${(aiChar as any).emoji} ${aiChar.name} moves to ${turn.move1.x},${turn.move1.y}.`);
        const aiFighterLatest = currentFighters.find(f => f.id === aiFighterId)!;
        const pathResult = findPath(aiFighterLatest, turn.move1, effectiveObstacles, currentFighters.filter(f => f.playerId === aiFighterLatest.playerId && f.id !== aiFighterId && f.currentHP > 0), currentFighters.filter(f => f.playerId !== aiFighterLatest.playerId && f.currentHP > 0), arena.gridWidth, arena.gridHeight, arena.terrain || []);
        
        if (pathResult && pathResult.path.length > 0) {
          await animateMovement(aiFighterId, pathResult.path, pathResult.cost);
          const dest = pathResult.path[pathResult.path.length - 1];
          currentFighters = currentFighters.map(f => 
            f.id === aiFighterId ? { ...f, x: dest.x, y: dest.y, distanceMovedThisTurn: f.distanceMovedThisTurn + pathResult.cost } : f
          );
          await delay(500); // brief pause after movement before attack
        }
      }

      // Attack
      if (turn.attackTargetId) {
        const aiFighterLatest = currentFighters.find(f => f.id === aiFighterId)!;
        const targetLatest = currentFighters.find(f => f.id === turn.attackTargetId)!;
        const targetChar = resolveCharacter(targetLatest.characterId)!;
        
        const targetName = targetChar.name;
        const targetEmoji = (targetChar as any).emoji;
        
        const weapon = weaponsData.find(w => w.id === turn.actionWeaponId)!;
        const targetWeapons = targetLatest.weaponIds.map(wId => weaponsData.find(w => w.id === wId)!);
        const combatResult = resolveAttack(aiChar, weapon, targetChar, targetWeapons);
        currentFighters = currentFighters.map(f => f.id === aiFighterId ? { ...f, hasAttackedThisTurn: true } : f);
        
        addLog(`${player2.name}'s ${(aiChar as any).emoji} ${aiChar.name} attacks ${targetEmoji} ${targetName} with ${weapon.name}! Rolled ${combatResult.attackRoll} vs defense ${combatResult.defenseRoll}.`);
        
        let damageDealt = 0;
        let targetDead = false;
        
        if (combatResult.damage > 0) {
          damageDealt = combatResult.damage;
          currentFighters = currentFighters.map(f => 
            f.id === turn.attackTargetId ? { ...f, currentHP: Math.max(0, f.currentHP - combatResult.damage) } : f
          );
          if (currentFighters.find(f => f.id === turn.attackTargetId)!.currentHP === 0) {
            targetDead = true;
          }
        }
        
        // Update React state prior to animation
        setFighters(currentFighters);
        setCombatAnim({
          targetId: turn.attackTargetId,
          attackerId: aiFighterId,
          targetPoint: { x: targetLatest.x, y: targetLatest.y },
          attackerPoint: { x: aiFighterLatest.x, y: aiFighterLatest.y },
          roll: combatResult.attackRoll,
          targetNumber: combatResult.defenseRoll,
          hit: combatResult.damage > 0,
          damage: damageDealt,
          isRanged: weapon.maxRange > 1,
          weaponId: weapon.id,
          rawAttackRoll: combatResult.rawAttackRoll,
          attackBonus: combatResult.attackBonus,
          rawDefenseRoll: combatResult.rawDefenseRoll,
          defenseBonus: combatResult.defenseBonus
        });

        setAiFocusTargetId(turn.attackTargetId);
        setIsAnimating(true);
        await delay(4000); // Wait for dice animation
        setCombatAnim(null);
        setIsAnimating(false);
        setAiFocusTargetId(null);

        if (combatResult.damage > 0) {
          addLog(`Hit! Deals ${damageDealt} damage.`);
          if (targetDead) {
            addLog(`${targetEmoji} ${targetName} is removed from play!`);
            if (scenario && scenario.type === 'relic' && scenario.relicCarrierId === turn.attackTargetId) {
               setScenario(prev => prev ? { ...prev, relicCarrierId: null } : prev);
               addLog(`The Relic is dropped!`);
            }
          }
        } else {
          addLog(`Missed.`);
        }
      }
      // Move 2
      if (turn.move2) {
        addLog(`${player2.name}'s ${(aiChar as any).emoji} ${aiChar.name} continues moving to ${turn.move2.x},${turn.move2.y}.`);
        const aiFighterLatest = currentFighters.find(f => f.id === aiFighterId)!;
        const pathResult = findPath(aiFighterLatest, turn.move2, effectiveObstacles, currentFighters.filter(f => f.playerId === aiFighterLatest.playerId && f.id !== aiFighterId && f.currentHP > 0), currentFighters.filter(f => f.playerId !== aiFighterLatest.playerId && f.currentHP > 0), arena.gridWidth, arena.gridHeight, arena.terrain || []);
        
        if (pathResult && pathResult.path.length > 0) {
          await animateMovement(aiFighterId, pathResult.path, pathResult.cost);
          const dest = pathResult.path[pathResult.path.length - 1];
          currentFighters = currentFighters.map(f => 
            f.id === aiFighterId ? { ...f, x: dest.x, y: dest.y, distanceMovedThisTurn: f.distanceMovedThisTurn + pathResult.cost } : f
          );
        }
      }

      // End activation
      setFighters(prevFighters => 
        prevFighters.map(f => f.id === aiFighterId ? { ...f, hasActivatedThisRound: true } : f)
      );

      const aiFighterLatest = currentFighters.find(f => f.id === aiFighterId)!;
      if (scenario && scenario.type === 'relic' && aiFighterLatest.currentHP > 0 && !scenario.relicCarrierId && scenario.relicPoint && aiFighterLatest.x === scenario.relicPoint.x && aiFighterLatest.y === scenario.relicPoint.y) {
         setScenario(prev => prev ? { ...prev, relicCarrierId: aiFighterLatest.id } : prev);
         addLog(`${player2.name} picks up the Relic!`);
      }
      
      setSelectedFighterId(null);
      setExecutingFighterId(null);
      setActivePlayerId(activePlayerId === 1 ? 2 : 1);
    } catch (err) {
      console.error("Error executing AI turn", err);
      addLog(`Error executing AI turn.`);
      setFighters(prevFighters => 
        prevFighters.map(f => f.id === initialAiFighter.id ? { ...f, hasActivatedThisRound: true } : f)
      );
      setSelectedFighterId(null);
      setExecutingFighterId(null);
      setActivePlayerId(activePlayerId === 1 ? 2 : 1);
    } finally {
      setIsAITurnExecuting(false);
      setExecutingFighterId(null);
    }
  };

  const selectedFighter = fighters.find(f => f.id === selectedFighterId) || null;
  const isHumanTurn = activePlayer.type === 'human';
  
  const lockedFighter = fighters.find(f => f.playerId === activePlayerId && !f.hasActivatedThisRound && (f.distanceMovedThisTurn > 0 || f.hasAttackedThisTurn));
  const isActiveFighter = selectedFighter && selectedFighter.playerId === activePlayerId && !selectedFighter.hasActivatedThisRound && (!lockedFighter || lockedFighter.id === selectedFighter.id);
  
  const allActivePlayerFightersActivated = fighters
    .filter(f => f.playerId === activePlayerId && f.currentHP > 0)
    .every(f => f.hasActivatedThisRound);

  const p1IsHuman = player1.type === 'human';
  const p2IsHuman = player2.type === 'human';

  const p1ExploredRef = useRef<Set<string>>(new Set());
  const p2ExploredRef = useRef<Set<string>>(new Set());

  const { p1Visible, p2Visible } = useMemo(() => {
    const v1 = new Set<string>();
    const v2 = new Set<string>();
    fighters.forEach(f => {
      if (f.currentHP > 0 && f.x >= 0 && f.y >= 0) {
        for (let y = 0; y < arena.gridHeight; y++) {
          for (let x = 0; x < arena.gridWidth; x++) {
            if (hasLineOfSight(f, {x, y}, effectiveObstacles, fighters)) {
              if (f.playerId === 1) {
                v1.add(`${x},${y}`);
              } else {
                v2.add(`${x},${y}`);
              }
            }
          }
        }
      }
    });
    return { p1Visible: v1, p2Visible: v2 };
  }, [fighters, arena.gridWidth, arena.gridHeight, effectiveObstacles]);

  const visibleSquares = useMemo(() => {
    if (p1IsHuman && p2IsHuman) {
      return activePlayerId === 1 ? p1Visible : p2Visible;
    } else if (p1IsHuman && !p2IsHuman) {
      return p1Visible;
    } else if (!p1IsHuman && p2IsHuman) {
      return p2Visible;
    } else {
      return new Set([...p1Visible, ...p2Visible]);
    }
  }, [p1Visible, p2Visible, p1IsHuman, p2IsHuman, activePlayerId]);

  const exploredSquares = useMemo(() => {
    p1Visible.forEach(key => p1ExploredRef.current.add(key));
    p2Visible.forEach(key => p2ExploredRef.current.add(key));
    
    if (p1IsHuman && p2IsHuman) {
      return activePlayerId === 1 ? p1ExploredRef.current : p2ExploredRef.current;
    } else if (p1IsHuman && !p2IsHuman) {
      return p1ExploredRef.current;
    } else if (!p1IsHuman && p2IsHuman) {
      return p2ExploredRef.current;
    } else {
      return new Set([...p1ExploredRef.current, ...p2ExploredRef.current]);
    }
  }, [p1Visible, p2Visible, p1IsHuman, p2IsHuman, activePlayerId]);

  useEffect(() => {
    if (isAITurnExecuting) {
      const targetFocusId = aiFocusTargetId || executingFighterId;
      if (targetFocusId) {
        const fighterToFocus = fighters.find(f => f.id === targetFocusId);
        if (fighterToFocus && visibleSquares.has(`${fighterToFocus.x},${fighterToFocus.y}`)) {
          if (selectedFighterId !== targetFocusId) {
            setSelectedFighterId(targetFocusId);
          }
        } else {
          if (selectedFighterId === targetFocusId) {
            setSelectedFighterId(null);
          }
        }
      }
    }
  }, [fighters, visibleSquares, isAITurnExecuting, executingFighterId, aiFocusTargetId, selectedFighterId]);

  let reachableSquares: Point[] = [];
  let attackableEnemies: string[] = [];

  const calculateAttackableEnemies = (fighter: Fighter, currentFighters: Fighter[]) => {
    const enemies = currentFighters.filter(f => f.playerId !== fighter.playerId && f.currentHP > 0);
    const equippedWeapons = fighter.weaponIds.map(wid => weaponsData.find(w => w.id === wid)!);
    
    const attackable: Fighter[] = [];
    
    for (const enemy of enemies) {
      const dist = getDistance(fighter, enemy);
      for (const w of equippedWeapons) {
        if (dist >= w.minRange && dist <= w.maxRange) {
           if (w.maxRange > 1) {
             if (hasLineOfSight(fighter, enemy, effectiveObstacles, currentFighters)) {
                attackable.push(enemy);
                break;
             }
           } else {
             attackable.push(enemy);
             break;
           }
        }
      }
    }
    
    return attackable;
  };


  let weaponRangeSquares: Point[] = [];
  let blockedLineOfSightSquares: Point[] = [];

  if (selectedFighter && isHumanTurn && isActiveFighter && !isAnimating && !combatAnim) {
    const equippedWeapons = selectedFighter.weaponIds.map(wid => weaponsData.find(w => w.id === wid)!);
    
    for (let x = 0; x < arena.gridWidth; x++) {
      for (let y = 0; y < arena.gridHeight; y++) {
        const sq = { x, y };
        const dist = getDistance(selectedFighter, sq);
        
        let valid = false;
        let requiresLos = false;
        
        for (const w of equippedWeapons) {
           if (dist >= w.minRange && dist <= w.maxRange) {
              valid = true;
              if (w.maxRange > 1) requiresLos = true;
           }
        }
        
        if (valid) {
           if (requiresLos) {
              if (hasLineOfSight(selectedFighter, sq, effectiveObstacles, fighters)) {
                 weaponRangeSquares.push(sq);
              } else {
                 blockedLineOfSightSquares.push(sq);
              }
           } else {
              weaponRangeSquares.push(sq);
           }
        }
      }
    }
  }

  if (isHumanTurn && isActiveFighter) {
    const char = resolveCharacter(selectedFighter.characterId)!;
    
    if (selectedFighter.distanceMovedThisTurn < char.movement) {
      reachableSquares = getReachableSquares(
        selectedFighter, 
        char.movement - selectedFighter.distanceMovedThisTurn, 
        effectiveObstacles, 
        fighters.filter(f => f.playerId === selectedFighter.playerId && f.id !== selectedFighter.id && f.currentHP > 0), 
        fighters.filter(f => f.playerId !== selectedFighter.playerId && f.currentHP > 0), 
        arena.gridWidth, arena.gridHeight,
        arena.terrain || []
      );
    }

    if (!selectedFighter.hasAttackedThisTurn) {
      attackableEnemies = calculateAttackableEnemies(selectedFighter, fighters).map(f => f.id);
    }
  }

  // Input Handlers

  const checkAutoEndTurn = (fighter: Fighter, currentFighters: Fighter[]) => {
    if (!autoEndTurn) return;
    const char = resolveCharacter(fighter.characterId)!;
    const remainingMove = char.movement - fighter.distanceMovedThisTurn;
    
    // Check if can attack
    let canAttack = false;
    if (!fighter.hasAttackedThisTurn) {
      canAttack = calculateAttackableEnemies(fighter, currentFighters).length > 0;
    }

    if (remainingMove === 0 && !canAttack) {
      setFighters(prev => prev.map(f => 
        f.id === fighter.id ? { ...f, hasActivatedThisRound: true } : f
      ));
      
      if (scenario && scenario.type === 'relic' && fighter.currentHP > 0 && !scenario.relicCarrierId && scenario.relicPoint && fighter.x === scenario.relicPoint.x && fighter.y === scenario.relicPoint.y) {
         setScenario(prev => prev ? { ...prev, relicCarrierId: fighter.id } : prev);
         addLog(`${fighter.playerId === 1 ? player1.name : player2.name} picks up the Relic!`);
      }
      
      setSelectedFighterId(null);
      setActivePlayerId(fighter.playerId === 1 ? 2 : 1);
    }
  };

  const handleFighterClick = (id: string) => {
    const clickedFighter = fighters.find(f => f.id === id)!;
    if (gameOver || isAnimating || isAITurnExecuting) return;
    
    // Select own fighter
    if (clickedFighter.playerId === activePlayerId) {
      if (!clickedFighter.hasActivatedThisRound) {
        setSelectedFighterId(clickedFighter.id);
      }
      return;
    }
    
    // Attack enemy
    if (isHumanTurn && isActiveFighter && clickedFighter.playerId !== activePlayerId && clickedFighter.currentHP > 0 && !selectedFighter!.hasAttackedThisTurn) {
      const attacker = selectedFighter!;
      const char = resolveCharacter(attacker.characterId)!;
      
      const equippedWeapons = attacker.weaponIds.map(wId => weaponsData.find(w => w.id === wId)!);
      
      const dist = getDistance(attacker, clickedFighter);
      
      // Can attack directly?
      let canAttackDirectly = false;
      for (const w of equippedWeapons) {
         if (dist >= w.minRange && dist <= w.maxRange) {
            if (w.maxRange > 1) {
               if (hasLineOfSight(attacker, clickedFighter, effectiveObstacles, fighters)) canAttackDirectly = true;
            } else {
               canAttackDirectly = true;
            }
         }
      }
      
      if (canAttackDirectly) {
        handleAttack(clickedFighter);
        return;
      }
      
      // Can move and attack?
      const remainingMove = char.movement - attacker.distanceMovedThisTurn;
      if (remainingMove > 0) {
        const validSquares = reachableSquares;
        for (const sq of validSquares) {
          const sqDist = getDistance(sq, clickedFighter);
          let canAttackFromSq = false;
          for (const w of equippedWeapons) {
            if (sqDist >= w.minRange && sqDist <= w.maxRange) {
              if (w.maxRange > 1) {
                 if (hasLineOfSight(sq, clickedFighter, effectiveObstacles, fighters)) canAttackFromSq = true;
              } else {
                 canAttackFromSq = true;
              }
            }
          }
          if (canAttackFromSq) {
             const pathResult = findPath(attacker, sq, effectiveObstacles, fighters.filter(f => f.playerId === attacker.playerId && f.id !== attacker.id && f.currentHP > 0), fighters.filter(f => f.playerId !== attacker.playerId && f.currentHP > 0), arena.gridWidth, arena.gridHeight,
               arena.terrain || []);
             if (pathResult) {
                addLog(`${activePlayer.name}'s ${(char as any).emoji} ${char.name} moves to attack.`);
                animateMovement(attacker.id, pathResult.path, pathResult.cost).then(() => {
                   const dest = pathResult.path[pathResult.path.length - 1];
                   const updatedAttacker = { 
                       ...attacker, 
                       x: dest.x, 
                       y: dest.y, 
                       distanceMovedThisTurn: attacker.distanceMovedThisTurn + pathResult.cost 
                   };
                   
                   setFighters(prev => {
                      const latestArrayContext = prev.map(f => f.id === attacker.id ? updatedAttacker : f);
                      const target = latestArrayContext.find(f => f.id === clickedFighter.id)!;
                      setTimeout(() => executeAttack(updatedAttacker, target, latestArrayContext), 0);
                      return latestArrayContext;
                   });
                });
                return;
             }
          }
        }
      }
    }
  };

  const handleSquareClick = async (x: number, y: number) => {
    if (gameOver || !isHumanTurn || !isActiveFighter || isAnimating) return;
    const attacker = selectedFighter!;
    const char = resolveCharacter(attacker.characterId)!;
    
    if (reachableSquares.some(p => p.x === x && p.y === y)) {
      const pathResult = findPath(attacker, {x, y}, effectiveObstacles, fighters.filter(f => f.playerId === attacker.playerId && f.id !== attacker.id && f.currentHP > 0), fighters.filter(f => f.playerId !== attacker.playerId && f.currentHP > 0), arena.gridWidth, arena.gridHeight,
        arena.terrain || []);
      if (pathResult) {
        addLog(`${activePlayer.name}'s ${(char as any).emoji} ${char.name} moves.`);
        await animateMovement(attacker.id, pathResult.path, pathResult.cost);
        
        setFighters(prev => {
           const updatedAttacker = prev.find(f => f.id === attacker.id)!;
           checkAutoEndTurn(updatedAttacker, prev);
           return prev;
        });
      }
    }
  };

  const handleAttack = async (target: Fighter) => {
    await executeAttack(selectedFighter!, target, fighters);
  };

  const executeAttack = async (attacker: Fighter, target: Fighter, currentFighters: Fighter[]) => {
    const attackerChar = resolveCharacter(attacker.characterId)!;
    const targetChar = resolveCharacter(target.characterId)!;
    
    const equippedWeapons = attacker.weaponIds.map(wId => weaponsData.find(w => w.id === wId)!);
    const targetWeapons = target.weaponIds.map(wId => weaponsData.find(w => w.id === wId)!);
    
    const dist = getDistance(attacker, target);
    
    // Find valid weapon
    let validWeapons = equippedWeapons.filter(w => {
       const inRange = dist >= w.minRange && dist <= w.maxRange;
       if (!inRange) return false;
       if (w.maxRange > 1 && !hasLineOfSight(attacker, target, effectiveObstacles, currentFighters)) return false;
       return true;
    });
    
    if (validWeapons.length === 0) {
      addLog("Target out of range or blocked line of sight.");
      return;
    }
    
    validWeapons.sort((a, b) => b.attackBonus - a.attackBonus);
    const weapon = validWeapons[0];
    
    const combatResult = resolveAttack(attackerChar, weapon, targetChar, targetWeapons);
    addLog(`${activePlayer.name}'s ${(attackerChar as any).emoji} ${attackerChar.name} attacks ${(targetChar as any).emoji} ${targetChar.name} with ${weapon.name}! Rolled ${combatResult.attackRoll} vs defense ${combatResult.defenseRoll}.`);
    
    setCombatAnim({
      targetId: target.id,
      attackerId: attacker.id,
      targetPoint: { x: target.x, y: target.y },
      attackerPoint: { x: attacker.x, y: attacker.y },
      roll: combatResult.attackRoll,
      targetNumber: combatResult.defenseRoll,
      hit: combatResult.damage > 0,
      damage: combatResult.damage,
      isRanged: weapon.maxRange > 1,
      weaponId: weapon.id,
      rawAttackRoll: combatResult.rawAttackRoll,
      attackBonus: combatResult.attackBonus,
      rawDefenseRoll: combatResult.rawDefenseRoll,
      defenseBonus: combatResult.defenseBonus
    });

    setIsAnimating(true);
    await delay(4000); // Wait for dice animation
    setCombatAnim(null);
    setIsAnimating(false);

    let nextFighters = [...currentFighters];
    if (combatResult.damage > 0) {
      addLog(`Hit! Deals ${combatResult.damage} damage.`);
      nextFighters = nextFighters.map(f => {
        if (f.id === target.id) {
           return { ...f, currentHP: Math.max(0, f.currentHP - combatResult.damage) };
        }
        if (f.id === attacker.id) {
           return { ...f, damageDealt: (f.damageDealt || 0) + combatResult.damage };
        }
        return f;
      });
      
      if (nextFighters.find(f => f.id === target.id)!.currentHP === 0) {
        addLog(`${(targetChar as any).emoji} ${targetChar.name} is removed from play!`);
        if (scenario && scenario.type === 'relic' && scenario.relicCarrierId === target.id) {
           setScenario(prev => prev ? { ...prev, relicCarrierId: null, relicPoint: { x: target.x, y: target.y } } : prev);
           addLog(`The Relic is dropped at ${target.x},${target.y}!`);
        }
        nextFighters = nextFighters.map(f => {
           if (f.id === attacker.id) {
              return { ...f, kills: (f.kills || 0) + 1 };
           }
           return f;
        });
      }
    } else {
      addLog(`Blocked or missed (0 damage).`);
    }

    const updatedAttacker = { ...nextFighters.find(f => f.id === attacker.id)!, hasAttackedThisTurn: true };
    nextFighters = nextFighters.map(f => f.id === attacker.id ? updatedAttacker : f);
    
    setFighters(nextFighters);
    checkAutoEndTurn(updatedAttacker, nextFighters);
  };

  const handleEndActivation = () => {
    if (!selectedFighter || !isHumanTurn || isAnimating) return;
    
    setFighters(prev => prev.map(f => 
      f.id === selectedFighterId ? { ...f, hasActivatedThisRound: true } : f
    ));

    if (scenario && scenario.type === 'relic' && selectedFighter.currentHP > 0 && !scenario.relicCarrierId && scenario.relicPoint && selectedFighter.x === scenario.relicPoint.x && selectedFighter.y === scenario.relicPoint.y) {
       setScenario(prev => prev ? { ...prev, relicCarrierId: selectedFighter.id } : prev);
       addLog(`${activePlayer.name} picks up the Relic!`);
    }

    setSelectedFighterId(null);
    setActivePlayerId(activePlayerId === 1 ? 2 : 1);
  };

  return (
    <div className="relative h-full w-full animate-in fade-in duration-500 overflow-hidden bg-[#0a0a0a]">
      
      {/* Grid Area */}
      <div className="absolute inset-0 flex flex-col items-center p-2 md:p-4 overflow-auto pb-[300px] md:pb-4 md:pr-[340px]">
        <div className="w-full max-w-[1200px] flex justify-between items-center mb-4 z-10 sticky left-4 right-4 gap-4 px-4">
          
          <div className="flex flex-col bg-[#1a1814]/80 backdrop-blur-md p-2 px-4 rounded border border-[#3d3329] shadow-lg">
            <span className="text-[10px] uppercase tracking-widest text-[#8a7a60]">Round</span>
            <span className="text-lg font-bold text-[#d4c5a9] tracking-tight">{round}</span>
          </div>

          {scenario && scenario.type !== 'elimination' && (
            <div className="flex flex-col items-center bg-[#1a1814]/80 backdrop-blur-md p-2 px-4 rounded border border-[#3d3329] shadow-lg flex-1 mx-4 max-w-sm text-center">
              <span className="text-[10px] uppercase tracking-widest text-[#8a7a60]">
                {scenario.type === 'control_point' ? 'Control Point' : scenario.type === 'breakthrough' ? 'Breakthrough' : 'Relic'} (Rounds: {Math.max(0, scenario.roundLimit - round + 1)})
              </span>
              <span className="text-sm font-bold text-[#d4c5a9] tracking-tight">
                {scenario.type === 'control_point' ? `Control: ${player1.name} ${scenario.controlScoreP1 || 0} — ${scenario.controlScoreP2 || 0} ${player2.name}` :
                 scenario.type === 'breakthrough' ? 'Reach the far edge' :
                 scenario.type === 'relic' ? `Relic: ${scenario.relicCarrierId ? (fighters.find(f => f.id === scenario.relicCarrierId)?.playerId === 1 ? player1.name : player2.name) : 'Uncontested'}` : ''}
              </span>
            </div>
          )}
          
          <div className="flex items-center gap-2 bg-[#1a1814]/80 backdrop-blur-md p-2 px-4 rounded border border-[#3d3329] shadow-lg">
             <input type="checkbox" id="autoEndTurn" checked={autoEndTurn} onChange={(e) => setAutoEndTurn(e.target.checked)} className="accent-[#8a7a60]" />
             <label htmlFor="autoEndTurn" className="text-xs text-[#8a7a60] uppercase tracking-widest cursor-pointer">Auto End</label>
          </div>

          <div className="flex flex-col items-end text-right bg-[#1a1814]/80 backdrop-blur-md p-2 px-4 rounded border border-[#3d3329] shadow-lg">
            <span className="text-[10px] uppercase tracking-widest text-[#8a7a60]">Active Turn</span>
            <span className="text-sm md:text-base font-bold tracking-tight uppercase" style={{ color: activePlayerId === 1 ? player1.color : player2.color }}>
              {activePlayerId === 1 ? player1.name : player2.name}
            </span>
          </div>
        </div>

        <div className="w-max min-w-max mx-auto relative shadow-2xl shadow-black/50 border border-[#1a1814]">
          <Grid 
            player1={player1}
            player2={player2}
            arena={{ ...arena, obstacles: effectiveObstacles }}
            fighters={fighters}
            selectedFighterId={selectedFighterId}
            reachableSquares={reachableSquares}
            attackableEnemies={attackableEnemies}
            weaponRangeSquares={weaponRangeSquares}
            blockedLineOfSightSquares={blockedLineOfSightSquares}
            visibleSquares={visibleSquares}
            exploredSquares={exploredSquares}
            combatAnim={combatAnim}
            suddenDeath={suddenDeath}
            objectiveSquares={scenario?.type === 'control_point' ? scenario.controlZone : scenario?.type === 'relic' && !scenario.relicCarrierId && scenario.relicPoint ? [scenario.relicPoint] : undefined}
            relicCarrierId={scenario?.relicCarrierId}
            onFighterClick={handleFighterClick}
            onSquareClick={handleSquareClick}
          />
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-4 justify-center bg-[#1a1814]/80 backdrop-blur-md p-2 px-4 rounded border border-[#3d3329] shadow-lg sticky bottom-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-amber-500/20 border-2 border-amber-500/50 rounded-sm"></div>
            <span className="text-[10px] uppercase tracking-widest text-[#8a7a60]">Melee Range</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-cyan-500/20 border-2 border-cyan-500/50 rounded-sm"></div>
            <span className="text-[10px] uppercase tracking-widest text-[#8a7a60]">Ranged Range</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-purple-500/20 border-2 border-purple-500/50 rounded-sm"></div>
            <span className="text-[10px] uppercase tracking-widest text-[#8a7a60]">Spell Range</span>
          </div>
        </div>
      </div>

      {/* Floating Side Panel & Log */}
      <div className="absolute left-0 right-0 bottom-0 md:left-auto md:top-4 md:right-4 md:bottom-4 md:w-80 flex flex-col md:gap-4 pointer-events-none z-[80] h-[300px] md:h-auto max-h-screen">
        <div className="pointer-events-auto flex flex-col min-h-0">
          <SidePanel 
            fighter={selectedFighter} 
            player={selectedFighter ? getPlayer(selectedFighter.playerId) : null}
            onEndActivation={handleEndActivation}
            isFightersTurn={isActiveFighter ?? false}
            canEndActivation={isActiveFighter ?? false}
            allActivePlayerFightersActivated={allActivePlayerFightersActivated}
          />
        </div>
        <div className="flex-1 pointer-events-auto min-h-0 bg-[#1a1814]/95 backdrop-blur-xl md:rounded border-t md:border border-[#3d3329] shadow-2xl flex flex-col overflow-hidden">
          <Log messages={logs} player1={player1} player2={player2} />
        </div>
      </div>

      {/* Full-screen Game Over Overlay */}
      {gameOver && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto"></div>
          
          <div className="relative z-10 text-center p-8 md:p-12 bg-gradient-to-b from-[#2a251e] to-[#1a1814] border-4 border-[#8a7a60] shadow-[0_0_100px_rgba(138,122,96,0.4)] max-w-xl w-full pointer-events-auto max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col">
            <h2 className="text-5xl md:text-6xl font-black text-[#d4c5a9] mb-4 tracking-tighter drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] shrink-0">
              GAME OVER
            </h2>
            
            <div className="py-6 my-4 border-y-2 border-[#3d3329] bg-black/30 shrink-0">
              <p className="text-3xl md:text-4xl font-bold uppercase tracking-widest" style={{ color: winner === 1 ? player1.color : winner === 2 ? player2.color : '#8a7a60' }}>
                {winner === 1 ? `${player1.name} Wins!` : winner === 2 ? `${player2.name} Wins!` : 'Draw!'}
              </p>
              {scenario && (
                <p className="text-sm font-bold uppercase tracking-widest text-[#d4c5a9] mt-2">
                  {round >= scenario.roundLimit ? 'Decided by round-limit tiebreak' : 
                   scenario.type === 'control_point' ? `Victory by Control Point (${scenario.controlScoreP1 || 0}-${scenario.controlScoreP2 || 0})` :
                   scenario.type === 'breakthrough' ? 'Victory by Breakthrough' :
                   scenario.type === 'relic' ? 'Victory by Relic Recovery' :
                   'Victory by Elimination'}
                </p>
              )}
            </div>
            
            <div className="mb-6 shrink-0">
              <table className="w-full text-left border-collapse text-sm text-[#d4c5a9]">
                <thead className="sticky top-0 bg-[#1a1814] z-10 shadow-md">
                  <tr className="border-b border-[#3d3329]">
                    <th className="py-2 px-4 font-semibold uppercase tracking-widest text-[#8a7a60]">Fighter</th>
                    <th className="py-2 px-4 font-semibold uppercase tracking-widest text-[#8a7a60]">Player</th>
                    <th className="py-2 px-4 font-semibold uppercase tracking-widest text-[#8a7a60] text-center">Status</th>
                    <th className="py-2 px-4 font-semibold uppercase tracking-widest text-[#8a7a60] text-right">Dmg</th>
                    <th className="py-2 px-4 font-semibold uppercase tracking-widest text-[#8a7a60] text-right">Kills</th>
                  </tr>
                </thead>
                <tbody>
                  {[...fighters].sort((a, b) => {
                    const killsA = a.kills || 0;
                    const killsB = b.kills || 0;
                    if (killsA !== killsB) return killsB - killsA;
                    
                    const dmgA = a.damageDealt || 0;
                    const dmgB = b.damageDealt || 0;
                    if (dmgA !== dmgB) return dmgB - dmgA;
                    
                    const survivalA = a.currentHP > 0 ? 1 : 0;
                    const survivalB = b.currentHP > 0 ? 1 : 0;
                    if (survivalA !== survivalB) return survivalB - survivalA;
                    
                    // We might not have them in charactersData directly if they are custom.
                    // But for sorting it's fine to fall back to 5.
                    const maxHPA = 5 + (resolveCharacter(a.characterId)?.toughness || 0);
                    const maxHPB = 5 + (resolveCharacter(b.characterId)?.toughness || 0);
                    const damageReceivedA = maxHPA - a.currentHP;
                    const damageReceivedB = maxHPB - b.currentHP;
                    
                    return damageReceivedA - damageReceivedB;
                  }).map((f, i) => {
                    // Try to resolve custom fighter name and emoji
                    let charName = 'Unknown';
                    let charEmoji = '❓';
                    const baseChar = resolveCharacter(f.characterId);
                    if (baseChar) {
                      charName = baseChar.name;
                      charEmoji = (baseChar as any).emoji;
                    } else {
                      // Attempt to resolve custom fighter... we'll just show Veteran for now
                      charName = 'Veteran';
                      charEmoji = '⭐';
                    }

                    const playerName = f.playerId === 1 ? player1.name : player2.name;
                    const playerColor = f.playerId === 1 ? player1.color : player2.color;
                    return (
                      <tr key={i} className="border-b border-[#3d3329]/50 hover:bg-white/5 transition-colors">
                        <td className="py-2 px-4 font-bold flex items-center gap-2">
                          <span className="text-lg">{charEmoji}</span>
                          <span>{charName}</span>
                        </td>
                        <td className="py-2 px-4 font-bold" style={{ color: playerColor }}>
                          {playerName}
                        </td>
                        <td className="py-2 px-4 text-center">
                          {f.currentHP > 0 ? (
                            <span className="text-green-500 font-bold tracking-wider">ALIVE</span>
                          ) : (
                            <span className="text-red-500/80 font-bold tracking-wider">DEAD</span>
                          )}
                        </td>
                        <td className="py-2 px-4 text-right font-mono">{f.damageDealt || 0}</td>
                        <td className="py-2 px-4 text-right font-mono text-[#8a7a60] font-bold">{f.kills || 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {(winner === 1 || winner === 2) ? (
              <PostMatchProgression 
                winnerId={winner as 1 | 2}
                player={winner === 1 ? player1 : player2}
                survivingFighters={fighters.filter(f => f.playerId === winner && f.currentHP > 0)}
                deadFighters={fighters.filter(f => f.currentHP <= 0)}
                onComplete={onBackToMenu}
              />
            ) : (
              <button 
                onClick={onBackToMenu}
                className="mt-4 px-12 py-4 bg-[#8a7a60] hover:bg-[#a39478] text-[#1a1814] text-lg font-black uppercase tracking-widest shadow-[0_0_20px_rgba(138,122,96,0.3)] hover:shadow-[0_0_30px_rgba(163,148,120,0.5)] hover:scale-105 transition-all duration-300 shrink-0"
              >
                Back to Menu
              </button>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
