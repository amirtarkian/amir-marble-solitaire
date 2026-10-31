// Why did a move cost marbles? We compare exact lines rather than guess: the coach's best
// line from before the move, and the best line after it. The marbles still standing at the
// end of the second line are the ones the move doomed; we trace where they came from and
// name the pattern when we recognise one.

import { UNJUMPABLE } from "../board/facts";
import { type Cell, isHole, label, rc } from "../board/geometry";
import type { Move } from "../game/state";

export interface Explanation {
  /** Where the leftover marbles end up under best play after the move. */
  stuck: Cell[];
  reasons: string[];
  /** Learn-page principle this mistake breaks, if one fits. */
  principle: number | null;
}

function play(board: Uint8Array, moves: readonly Move[]): Uint8Array {
  const b = board.slice();
  for (const m of moves) {
    b[m.from] = 0;
    b[m.over] = 0;
    b[m.to] = 1;
  }
  return b;
}

const marbles = (b: Uint8Array) => [...b.keys()].filter((i) => b[i]);

function neighbours(cell: Cell): Cell[] {
  const [r, c] = rc(cell);
  return [[0, 1], [0, -1], [1, 0], [-1, 0]]
    .map(([dr, dc]) => [r + dr, c + dc])
    .filter(([r2, c2]) => r2 >= 0 && r2 < 7 && c2 >= 0 && c2 < 7 && isHole(r2 * 7 + c2))
    .map(([r2, c2]) => r2 * 7 + c2);
}

const lonely = (b: Uint8Array, cell: Cell) => b[cell] === 1 && neighbours(cell).every((n) => !b[n]);

/** Follow one marble through a line: where it ends, or null if it gets captured. */
function track(cell: Cell, line: readonly Move[]): Cell | null {
  let at: Cell | null = cell;
  for (const m of line) {
    if (at === null) break;
    if (m.over === at) at = null;
    else if (m.from === at) at = m.to;
  }
  return at;
}

const list = (cells: Cell[]) => cells.map(label).join(" and ");

export function explain(before: Uint8Array, move: Move, bestBefore: readonly Move[], bestAfter: readonly Move[]): Explanation {
  const after = play(before, [move]);
  const endAfter = play(after, bestAfter);
  const endBefore = play(before, bestBefore);
  const stuck = marbles(endAfter);
  const reasons: string[] = [];
  let principle: number | null = null;
  const bestFinish = marbles(endBefore).length;
  const worse = stuck.length - bestFinish;

  // A marble the move put in a corner, which then never leaves.
  if (UNJUMPABLE.includes(move.to) && track(move.to, bestAfter) === move.to) {
    reasons.push(`You jumped into ${label(move.to)}, a corner hole that nothing can ever jump over, and even perfect play can't get that marble out again.`);
    principle = 3;
  }

  // Marbles the move left alone that are never picked up.
  const newlyLonely = marbles(after).filter((c) => lonely(after, c) && !lonely(before, c) && track(c, bestAfter) !== null);
  if (newlyLonely.length) {
    reasons.push(`Your move left ${list(newlyLonely)} with no neighbours, and no marble can ever get back next to ${newlyLonely.length > 1 ? "them" : "it"}.`);
    principle ??= 5;
  }

  // Leftovers stranded in corners at the end of best play.
  const cornered = stuck.filter((c) => UNJUMPABLE.includes(c));
  if (!reasons.length && cornered.length) {
    const clearedBefore = cornered.every((c) => !endBefore[c]);
    reasons.push(
      `Even the solver's best line after your move ends with a marble stuck on ${list(cornered)}, ${cornered.length > 1 ? "corner holes" : "a corner hole"} that nothing can jump over.` +
        (clearedBefore ? " The coach's line from before your move leaves no marble there." : ""),
    );
    principle = 3;
  }

  if (!reasons.length) {
    const alt = bestBefore[0];
    reasons.push(
      `Nothing is stranded yet, but the marbles no longer fit together: even perfect play from here leaves ${stuck.length} (on ${list(stuck)}). ` +
        (alt ? `The coach would have played ${label(alt.from)} → ${label(alt.to)}, keeping the group in shape for a ${bestFinish}-marble finish.` : ""),
    );
    principle = 4;
  }
  if (worse > 1) reasons.push(`That costs ${worse} marbles in one move.`);
  return { stuck, reasons, principle };
}
