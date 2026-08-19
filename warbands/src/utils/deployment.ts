import { Point, ArenaData, DeploymentStyle, Fighter } from '../types';

export function getDeploymentZones(
  style: DeploymentStyle,
  arena: ArenaData,
  p1Count: number,
  p2Count: number
): { p1Zone: Point[], p2Zone: Point[] } {
  const { gridWidth: w, gridHeight: h, obstacles } = arena;

  const isObstacle = (x: number, y: number) => obstacles.some(o => o.x === x && o.y === y);

  const getPoints = (condition: (x: number, y: number) => boolean) => {
    const pts: Point[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isObstacle(x, y) && condition(x, y)) pts.push({ x, y });
      }
    }
    return pts;
  };

  let p1Zone: Point[] = [];
  let p2Zone: Point[] = [];

  let expansion = 0;

  while (expansion < 10) {
    if (style === 'corners') {
      const regionW = Math.ceil(w / 3) + expansion;
      const regionH = Math.ceil(h / 3) + expansion;
      // P1 bottom-left, P2 top-right
      p1Zone = getPoints((x, y) => x < regionW && y >= h - regionH);
      p2Zone = getPoints((x, y) => x >= w - regionW && y < regionH);
    } else if (style === 'random') {
      p1Zone = getPoints(() => true);
      p2Zone = getPoints(() => true);
    } else if (style === 'battle-lines') {
      const depth = Math.max(2, Math.ceil(h / 4)) + expansion;
      // P1 bottom rows, P2 top rows
      p1Zone = getPoints((x, y) => y >= h - depth);
      p2Zone = getPoints((x, y) => y < depth);
    } else if (style === 'close-quarters') {
      const midX = Math.floor(w / 2);
      const midY = Math.floor(h / 2);
      const radiusX = 2 + expansion;
      const radiusY = 2 + expansion;
      // P1 bottom-middle, P2 top-middle
      p1Zone = getPoints((x, y) => Math.abs(x - midX) <= radiusX && y >= midY && y <= midY + radiusY);
      p2Zone = getPoints((x, y) => Math.abs(x - midX) <= radiusX && y < midY && y >= midY - radiusY - 1);
    }

    if (p1Zone.length >= p1Count && p2Zone.length >= p2Count) {
      break;
    }
    
    // If still not enough space, expand
    expansion++;
  }
  
  return { p1Zone, p2Zone };
}

export function autoPlaceFighters(
  fighters: Fighter[],
  playerId: 1 | 2,
  zone: Point[],
  allFighters: Fighter[]
): Fighter[] {
  let updatedFighters = [...fighters];
  const myUnplaced = updatedFighters.filter(f => f.playerId === playerId && f.x === -1);
  
  if (myUnplaced.length === 0) return updatedFighters;

  // Filter out squares already occupied by *any* placed fighter
  const isOccupied = (x: number, y: number) => {
    return updatedFighters.some(f => f.x === x && f.y === y);
  };

  const available = zone.filter(pt => !isOccupied(pt.x, pt.y));
  
  // Shuffle available
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  myUnplaced.forEach((f, i) => {
    if (i < available.length) {
      const idx = updatedFighters.findIndex(uf => uf.id === f.id);
      if (idx !== -1) {
        updatedFighters[idx] = { ...updatedFighters[idx], x: available[i].x, y: available[i].y };
      }
    }
  });

  return updatedFighters;
}
