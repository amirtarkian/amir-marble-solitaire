// Board facts the Learn page teaches, computed from the rules (mirrors engine/src/class.rs).

import { type Cell, HOLES, isHole, rc } from "./geometry";

/** Holes with no neighbour on both sides in any line: a marble there can't be jumped over. */
export const UNJUMPABLE: readonly Cell[] = HOLES.filter((h) => {
  const [r, c] = rc(h);
  const ok = (r2: number, c2: number) => r2 >= 0 && r2 < 7 && c2 >= 0 && c2 < 7 && isHole(r2 * 7 + c2);
  return !(ok(r, c - 1) && ok(r, c + 1)) && !(ok(r - 1, c) && ok(r + 1, c));
});

/** The 4-bit position class: parities no jump can change (see engine/src/class.rs). */
export function positionClass(cells: Iterable<Cell>): number {
  const a = [0, 0, 0], b = [0, 0, 0];
  for (const h of cells) {
    const [r, c] = rc(h);
    a[(r + c) % 3]++;
    b[(r + 6 - c) % 3]++;
  }
  return ((a[0] + a[1]) & 1) | (((a[1] + a[2]) & 1) << 1) | (((b[0] + b[1]) & 1) << 2) | (((b[1] + b[2]) & 1) << 3);
}

/** Holes where the last marble can end, if one marble is possible at all from `start`. */
export function finishingHoles(start: Cell): Cell[] {
  const k = positionClass(HOLES.filter((h) => h !== start));
  return HOLES.filter((h) => positionClass([h]) === k);
}
