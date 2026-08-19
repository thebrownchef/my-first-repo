import { Point, Fighter } from '../types';

export function getDistance(p1: Point, p2: Point): number {
  // Chebyshev distance (diagonal costs 1)
  return Math.max(Math.abs(p1.x - p2.x), Math.abs(p1.y - p2.y));
}

export function hasLineOfSight(
  start: Point,
  end: Point,
  obstacles: Point[],
  fighters: Fighter[] = []
): boolean {
  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  const obstacleSet = new Set((obstacles || []).map(o => `${o.x},${o.y}`));
  const fighterSet = new Set(fighters.filter(f => f.currentHP > 0).map(f => `${f.x},${f.y}`));

  while (true) {
    if (x0 === x1 && y0 === y1) break;

    if ((x0 !== start.x || y0 !== start.y) && (obstacleSet.has(`${x0},${y0}`) || fighterSet.has(`${x0},${y0}`))) {
      return false;
    }

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  return true;
}

export function findPath(
  start: Point,
  end: Point,
  obstacles: Point[],
  allies: Point[],
  enemies: Point[],
  gridWidth: number,
  gridHeight: number,
  terrain: Point[] = []
): { path: Point[]; cost: number } | null {
  // Dijkstra for shortest path avoiding obstacles and fighters
  
  const terrainCostMap = new Map<string, number>();
  terrain.forEach(t => {
    if (t.movementCost !== undefined) terrainCostMap.set(`${t.x},${t.y}`, t.movementCost);
  });
  
  const queue: { point: Point; path: Point[]; cost: number }[] = [{ point: start, path: [], cost: 0 }];
  const costs = new Map<string, number>();
  
  const obstacleSet = new Set<string>();
  obstacles.forEach(o => obstacleSet.add(`${o.x},${o.y}`));
  
  const blocked = new Set<string>();
  obstacles.forEach(o => blocked.add(`${o.x},${o.y}`));
  allies.forEach(f => blocked.add(`${f.x},${f.y}`));
  enemies.forEach(f => blocked.add(`${f.x},${f.y}`));

  const enemySet = new Set<string>();
  enemies.forEach(e => enemySet.add(`${e.x},${e.y}`));
  
  const allySet = new Set<string>();
  allies.forEach(a => allySet.add(`${a.x},${a.y}`));
  
  costs.set(`${start.x},${start.y}`, 0);
  
  const dirs = [
    { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }
  ];

  while (queue.length > 0) {
    // Sort queue to get lowest cost (simple priority queue)
    queue.sort((a, b) => a.cost - b.cost);
    const { point, path, cost } = queue.shift()!;
    
    if (point.x === end.x && point.y === end.y) {
      return { path, cost };
    }

    for (const dir of dirs) {
      const next: Point = { x: point.x + dir.x, y: point.y + dir.y };
      const key = `${next.x},${next.y}`;
      
      if (
        next.x >= 0 && next.x < gridWidth &&
        next.y >= 0 && next.y < gridHeight &&
        !obstacleSet.has(key) &&
        !enemySet.has(key)
      ) {
        // Can't terminate on an ally
        if (next.x === end.x && next.y === end.y && allySet.has(key)) {
           continue;
        }
        const moveCost = terrainCostMap.get(key) || 1;
        const newCost = cost + moveCost;
        
        if (!costs.has(key) || newCost < costs.get(key)!) {
          costs.set(key, newCost);
          queue.push({ point: next, path: [...path, next], cost: newCost });
        }
      }
    }
  }

  return null;
}

export function getReachableSquares(
  start: Point,
  maxMove: number,
  obstacles: Point[],
  allies: Point[],
  enemies: Point[],
  gridWidth: number,
  gridHeight: number,
  terrain: Point[] = []
): (Point & { cost: number })[] {
  // Dijkstra to find all reachable squares within maxMove cost
  const reachable: (Point & { cost: number })[] = [];
  
  const terrainCostMap = new Map<string, number>();
  terrain.forEach(t => {
    if (t.movementCost !== undefined) terrainCostMap.set(`${t.x},${t.y}`, t.movementCost);
  });
  
  const queue: { point: Point; dist: number }[] = [{ point: start, dist: 0 }];
  const costs = new Map<string, number>();
  
  const obstacleSet = new Set<string>();
  obstacles.forEach(o => obstacleSet.add(`${o.x},${o.y}`));
  
  const blocked = new Set<string>();
  obstacles.forEach(o => blocked.add(`${o.x},${o.y}`));
  allies.forEach(f => blocked.add(`${f.x},${f.y}`));
  enemies.forEach(f => blocked.add(`${f.x},${f.y}`));

  const enemySet = new Set<string>();
  enemies.forEach(e => enemySet.add(`${e.x},${e.y}`));
  
  const allySet = new Set<string>();
  allies.forEach(a => allySet.add(`${a.x},${a.y}`));
  
  costs.set(`${start.x},${start.y}`, 0);
  
  const dirs = [
    { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }
  ];

  while (queue.length > 0) {
    queue.sort((a, b) => a.dist - b.dist);
    const { point, dist } = queue.shift()!;
    
    if (dist > 0 && !reachable.some(p => p.x === point.x && p.y === point.y)) {
      if (!allySet.has(`${point.x},${point.y}`)) {
        reachable.push({ ...point, cost: dist });
      }
    }
    
    for (const dir of dirs) {
      const next: Point = { x: point.x + dir.x, y: point.y + dir.y };
      const key = `${next.x},${next.y}`;
      
      if (
        next.x >= 0 && next.x < gridWidth &&
        next.y >= 0 && next.y < gridHeight &&
        !obstacleSet.has(key) &&
        !enemySet.has(key)
      ) {
        const moveCost = terrainCostMap.get(key) || 1;
        const newDist = dist + moveCost;
        
        if (newDist <= maxMove) {
          if (!costs.has(key) || newDist < costs.get(key)!) {
            costs.set(key, newDist);
            queue.push({ point: next, dist: newDist });
          }
        }
      }
    }
  }

  return reachable;
}
