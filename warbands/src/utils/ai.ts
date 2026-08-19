import { resolveCharacter } from "./characters";
import { Fighter, Point, ArenaData, BASE_HP } from '../types';
import charactersData from '../data/characters.json';
import weaponsDataJson from '../data/weapons.json';
import { getDistance, getReachableSquares, findPath, hasLineOfSight } from './grid';

const weaponsData = weaponsDataJson as import('../types').WeaponData[];

export function calculateAITurn(
  activeFighter: Fighter,
  allFighters: Fighter[],
  arena: ArenaData,
  suddenDeath: number
): { move1: Point | null, attackTargetId: string | null, actionWeaponId: string | null, move2: Point | null } {
  
  const character = resolveCharacter(activeFighter.characterId)!;
  const equippedWeapons = activeFighter.weaponIds.map(wid => weaponsData.find(w => w.id === wid)!);
  
  const enemies = allFighters.filter(f => f.playerId !== activeFighter.playerId && f.currentHP > 0);
  const otherFighters = allFighters.filter(f => f.id !== activeFighter.id && f.currentHP > 0);
  const allies = otherFighters.filter(f => f.playerId === activeFighter.playerId);
  
  if (enemies.length === 0) return { move1: null, attackTargetId: null, actionWeaponId: null, move2: null };

  const remainingBudget = character.movement - activeFighter.distanceMovedThisTurn;
  
  const maxHP = BASE_HP + character.toughness;
  const isLowHP = (activeFighter.currentHP / maxHP) < 0.5;
  
  let move1: Point | null = null;
  let attackTargetId: string | null = null;
  let actionWeaponId: string | null = null;
  let move2: Point | null = null;
  
  let currentPos = { x: activeFighter.x, y: activeFighter.y };
  let remainingAfterAttack = remainingBudget;

  const getDistToEdge = (p: Point) => Math.min(
    p.x,
    p.y,
    arena.gridWidth - 1 - p.x,
    arena.gridHeight - 1 - p.y
  );

  const getBestWeapon = (pos: Point, enemy: Fighter, dist: number) => {
     let validWeapons = equippedWeapons.filter(w => {
       const inRange = dist >= w.minRange && dist <= w.maxRange;
       if (!inRange) return false;
       if (w.maxRange > 1 && !hasLineOfSight(pos, enemy, arena.obstacles, allFighters)) return false;
       return true;
     });
     
     if (validWeapons.length === 0) return null;
     
     validWeapons.sort((a, b) => {
       const aStat = (character as any)[a.requirement] as number || character.attack;
       const bStat = (character as any)[b.requirement] as number || character.attack;
       const aPower = aStat + (a.attackBonus || 0);
       const bPower = bStat + (b.attackBonus || 0);
       return bPower - aPower;
     });
     return validWeapons[0];
  };

  let bestTarget = null;
  let minHP = Infinity;
  for (const enemy of enemies) {
    const dist = getDistance(currentPos, enemy);
    const wpn = getBestWeapon(currentPos, enemy, dist);
    if (wpn && enemy.currentHP < minHP) {
      minHP = enemy.currentHP;
      bestTarget = enemy;
      actionWeaponId = wpn.id;
    }
  }

  if (bestTarget) {
    attackTargetId = bestTarget.id;
  } else {
    if (!isLowHP) {
      const reachableSquares = getReachableSquares(
        activeFighter, 
        remainingBudget, 
        arena.obstacles, 
        allies, 
        enemies, 
        arena.gridWidth, 
        arena.gridHeight,
        arena.terrain || []
      );
      
      let bestSq = null;
      let minScore = Infinity;
      let bestTarget2 = null;
      let minMove = Infinity;

      for (const sq of reachableSquares) {
        const edgePenalty = (suddenDeath >= 0 && getDistToEdge(sq) <= suddenDeath) ? 10000 : 0;
        for (const enemy of enemies) {
          const dist = getDistance(sq, enemy);
          const wpn = getBestWeapon(sq, enemy, dist);
          if (wpn) {
            const pathResult = findPath(activeFighter, sq, arena.obstacles, allies, enemies, arena.gridWidth, arena.gridHeight, arena.terrain || []);
            if (pathResult && pathResult.cost <= remainingBudget) {
              const score = edgePenalty + (enemy.currentHP * 100) + pathResult.cost;
              if (score < minScore) {
                minScore = score;
                bestTarget2 = enemy;
                bestSq = sq;
                minMove = pathResult.cost;
                actionWeaponId = wpn.id;
              }
            }
          }
        }
      }

      if (bestTarget2 && bestSq) {
        move1 = bestSq;
        attackTargetId = bestTarget2.id;
        currentPos = bestSq;
        remainingAfterAttack = remainingBudget - minMove;
      }
    }
  }

  if (remainingAfterAttack > 0) {
    const mockFighter = { ...activeFighter, x: currentPos.x, y: currentPos.y };
    const reachableSquares2 = getReachableSquares(
      mockFighter, 
      remainingAfterAttack, 
      arena.obstacles, 
      allies, 
      enemies, 
      arena.gridWidth, 
      arena.gridHeight,
      arena.terrain || []
    );
    
    if (reachableSquares2.length > 0) {
      const outOfRangeEnemies = enemies.filter(e => {
        const dist = getDistance(currentPos, e);
        return getBestWeapon(currentPos, e, dist) === null;
      });
      const nearestEnemy = outOfRangeEnemies.length > 0 
          ? outOfRangeEnemies.sort((a, b) => getDistance(currentPos, a) - getDistance(currentPos, b))[0]
        : [...enemies].sort((a, b) => getDistance(currentPos, a) - getDistance(currentPos, b))[0];
      
      let bestMoveSquare = null;
      let bestScore = isLowHP ? -Infinity : Infinity;

      for (const sq of reachableSquares2) {
        const edgePenalty = (suddenDeath >= 0 && getDistToEdge(sq) <= suddenDeath) ? 10000 : 0;
        const d = getDistance(sq, nearestEnemy);
        
        if (isLowHP) {
           const score = d - edgePenalty;
           if (score > bestScore) {
             bestScore = score;
             bestMoveSquare = sq;
           }
        } else {
           const score = d + edgePenalty;
           if (score < bestScore) {
             bestScore = score;
             bestMoveSquare = sq;
           }
        }
      }
      
      const currentEdgePenalty = (suddenDeath >= 0 && getDistToEdge(currentPos) <= suddenDeath) ? 10000 : 0;
      const currentD = getDistance(currentPos, nearestEnemy);
      const currentScore = isLowHP ? (currentD - currentEdgePenalty) : (currentD + currentEdgePenalty);

      if (isLowHP) {
         if (bestScore <= currentScore) bestMoveSquare = null;
      } else {
         if (bestScore >= currentScore) bestMoveSquare = null;
      }
      
      if (bestMoveSquare) {
        if (!move1 && !attackTargetId) move1 = bestMoveSquare;
        else move2 = bestMoveSquare;
      }
    }
  }

  return { move1, attackTargetId, actionWeaponId, move2 };
}
