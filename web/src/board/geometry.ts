// The 37-hole French board on a 7×7 grid: cell = r * 7 + c, a hole when
// |r-3| + |c-3| <= 4. Same convention as the Rust engine.

export type Cell = number;

export const CENTRE: Cell = 24;
export const SPACING = 1; // world units between neighbouring holes

export const rc = (cell: Cell): [number, number] => [Math.floor(cell / 7), cell % 7];

export function isHole(cell: Cell): boolean {
  if (cell < 0 || cell >= 49) return false;
  const [r, c] = rc(cell);
  return Math.abs(r - 3) + Math.abs(c - 3) <= 4;
}

export const HOLES: readonly Cell[] = Array.from({ length: 49 }, (_, i) => i).filter(isHole);

/** Standard notation: file a–g is the column, rank 1–7 counts up from the bottom. */
export function label(cell: Cell): string {
  const [r, c] = rc(cell);
  return String.fromCharCode(97 + c) + (7 - r);
}

export function parseLabel(s: string): Cell | null {
  const m = /^([a-g])([1-7])$/.exec(s);
  if (!m) return null;
  const cell = (7 - Number(m[2])) * 7 + (m[1].charCodeAt(0) - 97);
  return isHole(cell) ? cell : null;
}

/** Board-plane position of a hole; y is up in the 3D scene. */
export function holeXZ(cell: Cell): { x: number; z: number } {
  const [r, c] = rc(cell);
  return { x: (c - 3) * SPACING, z: (r - 3) * SPACING };
}
