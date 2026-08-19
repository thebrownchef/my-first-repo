import { Point, ArenaData, ScenarioType, ScenarioState } from '../types';

const DEFAULT_ROUND_LIMIT = 15;

function isObstacle(arena: ArenaData, x: number, y: number): boolean {
  return arena.obstacles.some(o => o.x === x && o.y === y);
}

function getCenterEmptyPoint(arena: ArenaData): Point {
  const cx = Math.floor(arena.gridWidth / 2);
  const cy = Math.floor(arena.gridHeight / 2);
  
  // Spiral search from center
  for (let r = 0; r < Math.max(arena.gridWidth, arena.gridHeight); r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) === r || Math.abs(dy) === r) {
          const px = cx + dx;
          const py = cy + dy;
          if (px >= 0 && px < arena.gridWidth && py >= 0 && py < arena.gridHeight) {
            if (!isObstacle(arena, px, py)) {
              return { x: px, y: py };
            }
          }
        }
      }
    }
  }
  return { x: cx, y: cy };
}

function getControlZone(arena: ArenaData, size: number): Point[] {
  const center = getCenterEmptyPoint(arena);
  const zone: Point[] = [];
  
  // Try to create a block centered roughly on the empty center point
  // We'll use a 2x2 or 3x3 depending on size. Let's do a 3x3 centered on 'center' but excluding obstacles
  const radius = Math.floor(size / 2);
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const px = center.x + dx;
      const py = center.y + dy;
      if (px >= 0 && px < arena.gridWidth && py >= 0 && py < arena.gridHeight) {
        if (!isObstacle(arena, px, py)) {
          zone.push({ x: px, y: py });
        }
      }
    }
  }
  return zone;
}

export function generateScenario(type: ScenarioType | 'random', arena: ArenaData): ScenarioState {
  let selectedType = type;
  if (selectedType === 'random') {
    const types: ScenarioType[] = ['elimination', 'control_point', 'breakthrough', 'relic'];
    selectedType = types[Math.floor(Math.random() * types.length)];
  }

  const baseState: ScenarioState = {
    type: selectedType as ScenarioType,
    roundLimit: DEFAULT_ROUND_LIMIT
  };

  switch (selectedType) {
    case 'control_point':
      return {
        ...baseState,
        controlZone: getControlZone(arena, 3), // 3x3 area max
        controlScoreP1: 0,
        controlScoreP2: 0,
        controlScoreTarget: 3
      };
    case 'relic':
      return {
        ...baseState,
        relicPoint: getCenterEmptyPoint(arena),
        relicCarrierId: null
      };
    case 'breakthrough':
    case 'elimination':
    default:
      return baseState;
  }
}
