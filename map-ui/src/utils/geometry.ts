// Douglas-Peucker algorithm for geometry simplification
export const simplifyGeometry = (coords: number[][], tolerance: number): number[][] => {
  if (coords.length <= 2) return coords;

  const sqTolerance = tolerance * tolerance;

  // Find point with maximum distance from line segment
  let maxDist = 0;
  let maxIndex = 0;
  const first = coords[0];
  const last = coords[coords.length - 1];

  for (let i = 1; i < coords.length - 1; i++) {
    const dist = perpendicularDistanceSquared(coords[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > sqTolerance) {
    const left = simplifyGeometry(coords.slice(0, maxIndex + 1), tolerance);
    const right = simplifyGeometry(coords.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
};

const perpendicularDistanceSquared = (point: number[], lineStart: number[], lineEnd: number[]): number => {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;

  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return (x - x1) ** 2 + (y - y1) ** 2;
  }

  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return (x - projX) ** 2 + (y - projY) ** 2;
};
