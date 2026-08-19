import { Point, ArenaData } from '../types';

function isValidPoint(p: Point, width: number, height: number): boolean {
  return p.x >= 0 && p.x < width && p.y >= 0 && p.y < height;
}

function checkConnectivity(width: number, height: number, obstacles: Point[]): boolean {
  const grid: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));
  for (const obs of obstacles) {
    if (isValidPoint(obs, width, height)) {
      grid[obs.y][obs.x] = true;
    }
  }

  // Find a starting empty square
  let start: Point | null = null;
  let totalEmpty = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!grid[y][x]) {
        totalEmpty++;
        if (!start) start = { x, y };
      }
    }
  }

  if (!start) return false;

  const visited: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));
  const queue: Point[] = [start];
  visited[start.y][start.x] = true;
  let reachedCount = 1;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = [
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y - 1 },
      { x: current.x, y: current.y + 1 }
    ];

    for (const n of neighbors) {
      if (isValidPoint(n, width, height) && !grid[n.y][n.x] && !visited[n.y][n.x]) {
        visited[n.y][n.x] = true;
        reachedCount++;
        queue.push(n);
      }
    }
  }

  // Allow for some minor disconnected pockets, but require at least 90% of empty squares to be connected
  return reachedCount >= totalEmpty * 0.9;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateRuinedChapel(config: any, width: number, height: number): { obstacles: Point[], terrain: Point[] } {
  const obstacles: Point[] = [];
  const terrain: Point[] = [];
  const { pewLength = 3, numRows = 2, aisleWidth = 2, hasCornerPillars = true } = config || {};

  // Corner pillars
  if (hasCornerPillars) {
    if (Math.random() > 0.3) obstacles.push({ x: 2, y: 2 });
    if (Math.random() > 0.3) obstacles.push({ x: width - 3, y: 2 });
    if (Math.random() > 0.3) obstacles.push({ x: 2, y: height - 3 });
    if (Math.random() > 0.3) obstacles.push({ x: width - 3, y: height - 3 });
  }

  // Pews (symmetric rows)
  const centerY = Math.floor(height / 2);
  const centerX = Math.floor(width / 2);
  
  const yOffsets = [];
  if (numRows === 2) {
    yOffsets.push(centerY - 2, centerY + 1);
  } else if (numRows === 3) {
    yOffsets.push(centerY - 3, centerY, centerY + 3);
  } else {
    yOffsets.push(centerY);
  }

  const leftPewEndX = centerX - Math.floor(aisleWidth / 2) - 1;
  const rightPewStartX = centerX + Math.ceil(aisleWidth / 2);

  for (const y of yOffsets) {
    const actualPewLength = randomInt(pewLength - 1, pewLength + 1);
    
    // Left side
    for (let i = 0; i < actualPewLength; i++) {
      obstacles.push({ x: leftPewEndX - i, y });
    }
    // Right side
    for (let i = 0; i < actualPewLength; i++) {
      obstacles.push({ x: rightPewStartX + i, y });
    }
  }

  // Add rubble terrain
  const numRubble = Math.floor((width * height) * 0.05);
  for (let i = 0; i < numRubble; i++) {
    const x = randomInt(1, width - 2);
    const y = randomInt(1, height - 2);
    if (!obstacles.some(o => o.x === x && o.y === y) && !terrain.some(t => t.x === x && t.y === y)) {
      terrain.push({ x, y, terrainClassification: 'rubble', movementCost: 2 });
    }
  }

  return { obstacles, terrain };
}

export function generateDenseForest(config: any, width: number, height: number): { obstacles: Point[], terrain: Point[] } {
  const obstacles: Point[] = [];
  const terrain: Point[] = [];
  const { targetDensity = 0.15, minClusterSize = 1, maxClusterSize = 2 } = config || {};
  
  const targetObstacles = Math.floor(width * height * targetDensity);
  
  while (obstacles.length < targetObstacles) {
    const x = randomInt(1, width - 2);
    const y = randomInt(1, height - 2);
    
    const clusterSize = randomInt(minClusterSize, maxClusterSize);
    let added = 0;
    
    // Try to add a cluster around x,y
    for (let dx = 0; dx < clusterSize; dx++) {
      for (let dy = 0; dy < clusterSize; dy++) {
        if (added >= clusterSize) break;
        
        const px = x + dx;
        const py = y + dy;
        
        if (isValidPoint({x: px, y: py}, width, height)) {
          // Avoid placing directly adjacent to spawn corners too heavily
          if ((px < 3 && py < 3) || (px > width - 4 && py > height - 4)) continue;
          
          if (!obstacles.some(o => o.x === px && o.y === py)) {
            obstacles.push({ x: px, y: py });
            added++;
            
            // Add undergrowth terrain around obstacles
            const neighbors = [
              { x: px - 1, y: py }, { x: px + 1, y: py },
              { x: px, y: py - 1 }, { x: px, y: py + 1 }
            ];
            for (const n of neighbors) {
              if (isValidPoint(n, width, height) && Math.random() > 0.5) {
                if (!obstacles.some(o => o.x === n.x && o.y === n.y) && !terrain.some(t => t.x === n.x && t.y === n.y)) {
                  terrain.push({ x: n.x, y: n.y, terrainClassification: 'undergrowth', movementCost: 2 });
                }
              }
            }
          }
        }
      }
    }
  }

  // Fill some remaining empty space with undergrowth
  const numUndergrowth = Math.floor((width * height) * 0.08);
  for (let i = 0; i < numUndergrowth; i++) {
    const x = randomInt(1, width - 2);
    const y = randomInt(1, height - 2);
    if (!obstacles.some(o => o.x === x && o.y === y) && !terrain.some(t => t.x === x && t.y === y)) {
      terrain.push({ x, y, terrainClassification: 'undergrowth', movementCost: 2 });
    }
  }

  return { obstacles, terrain };
}

export function generateRuinedVillage(config: any, width: number, height: number): { obstacles: Point[], terrain: Point[] } {
  const obstacles: Point[] = [];
  const terrain: Point[] = [];
  const { numBuildings = 5, minBuildingWidth = 2, maxBuildingWidth = 3, minBuildingHeight = 2, maxBuildingHeight = 3 } = config || {};
  
  const buildings: {x: number, y: number, w: number, h: number}[] = [];
  
  for (let i = 0; i < numBuildings * 2; i++) { // Max attempts
    if (buildings.length >= numBuildings) break;
    
    const w = randomInt(minBuildingWidth, maxBuildingWidth);
    const h = randomInt(minBuildingHeight, maxBuildingHeight);
    const x = randomInt(1, width - w - 1);
    const y = randomInt(1, height - h - 1);
    
    // Check overlap with existing buildings + 1 tile corridor
    let overlap = false;
    for (const b of buildings) {
      if (x < b.x + b.w + 1 && x + w + 1 > b.x &&
          y < b.y + b.h + 1 && y + h + 1 > b.y) {
        overlap = true;
        break;
      }
    }
    
    // Check spawn points buffer
    if ((x < 4 && y < 4) || (x > width - 5 && y > height - 5)) {
      overlap = true;
    }
    
    if (!overlap) {
      buildings.push({x, y, w, h});
      for (let bx = x; bx < x + w; bx++) {
        for (let by = y; by < y + h; by++) {
          obstacles.push({ x: bx, y: by });
        }
      }
      
      // Add debris terrain around buildings
      for (let bx = x - 1; bx <= x + w; bx++) {
        for (let by = y - 1; by <= y + h; by++) {
          if (isValidPoint({x: bx, y: by}, width, height) && Math.random() > 0.4) {
            if (!obstacles.some(o => o.x === bx && o.y === by) && !terrain.some(t => t.x === bx && t.y === by)) {
              terrain.push({ x: bx, y: by, terrainClassification: 'debris', movementCost: 2 });
            }
          }
        }
      }
    }
  }
  
  return { obstacles, terrain };
}

export function generateArenaLayout(arena: ArenaData): { obstacles: Point[], terrain: Point[], width: number, height: number } {
  const MAX_RETRIES = 10;
  
  const minWidth = arena.generation?.minWidth ?? 16;
  const maxWidth = arena.generation?.maxWidth ?? 20;
  const minHeight = arena.generation?.minHeight ?? 14;
  const maxHeight = arena.generation?.maxHeight ?? 18;

  const width = randomInt(minWidth, maxWidth);
  const height = randomInt(minHeight, maxHeight);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let result = { obstacles: [] as Point[], terrain: [] as Point[] };
    
    if (arena.theme === 'ruined_chapel') {
      result = generateRuinedChapel(arena.generation, width, height);
    } else if (arena.theme === 'dense_forest') {
      result = generateDenseForest(arena.generation, width, height);
    } else if (arena.theme === 'ruined_village') {
      result = generateRuinedVillage(arena.generation, width, height);
    }

    result.obstacles = result.obstacles.filter(p => p.x >= 0 && p.x < width && p.y >= 0 && p.y < height);
    result.terrain = result.terrain.filter(p => p.x >= 0 && p.x < width && p.y >= 0 && p.y < height);
    
    if (checkConnectivity(width, height, result.obstacles)) {
      return { obstacles: result.obstacles, terrain: result.terrain, width, height };
    }
  }
  
  // Fallback to original authored obstacles if all generation attempts fail
  return { obstacles: arena.obstacles, terrain: arena.terrain || [], width: arena.gridWidth, height: arena.gridHeight };
}
