// Turning a solver line into words: which areas of the board each phase clears, where a
// catalyst package happens (a marble jumps out and comes straight back), and when corner
// marbles get out.

import { UNJUMPABLE, finishingHoles } from "../board/facts";
import { type Cell, label, rc } from "../board/geometry";
import { type Move, startBoard } from "../game/state";

export type Region = "top arm" | "bottom arm" | "left arm" | "right arm" | "shoulders" | "centre";

export const REGIONS: Region[] = ["top arm", "bottom arm", "left arm", "right arm", "shoulders", "centre"];

export function regionOf(cell: Cell): Region {
  const [r, c] = rc(cell);
  if (r <= 1 && c >= 2 && c <= 4) return "top arm";
  if (r >= 5 && c >= 2 && c <= 4) return "bottom arm";
  if (c <= 1 && r >= 2 && r <= 4) return "left arm";
  if (c >= 5 && r >= 2 && r <= 4) return "right arm";
  if (Math.abs(r - 3) === 2 && Math.abs(c - 3) === 2) return "shoulders";
  return "centre";
}

export interface PhaseNote {
  name: string;
  from: number;
  to: number;
  text: string;
}

export interface LineNotes {
  phases: PhaseNote[];
  /** Move numbers (1-based) where a catalyst package starts. */
  packages: number[];
  /** Move numbers where a marble jumps out of a corner hole. */
  cornerExits: number[];
}

const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const movesText = (ms: number[]) => (ms.length === 1 ? `move ${ms[0]}` : `moves ${join(ms.map(String))}`);

/** A marble jumps A→C and, within three moves, C→A again: a catalyst package. */
export function findPackages(line: readonly Move[]): number[] {
  const out: number[] = [];
  line.forEach((m, i) => {
    for (let j = i + 1; j <= Math.min(i + 3, line.length - 1); j++) {
      if (line[j].from === m.to && line[j].to === m.from) {
        out.push(i + 1);
        break;
      }
    }
  });
  return out;
}

export function describeLine(start: Cell, line: readonly Move[]): LineNotes {
  const packages = findPackages(line);
  const cornerExits = line.map((m, i) => (UNJUMPABLE.includes(m.from) ? i + 1 : 0)).filter(Boolean);
  const board = startBoard(start);
  const count = (b: Uint8Array) => {
    const c = new Map<Region, number>(REGIONS.map((r) => [r, 0]));
    b.forEach((v, i) => v && c.set(regionOf(i), c.get(regionOf(i))! + 1));
    return c;
  };
  const spans = [
    { name: "Opening", from: 1, to: Math.min(8, line.length) },
    { name: "Middle game", from: 9, to: Math.min(20, line.length) },
    { name: "Closing", from: 21, to: line.length },
  ].filter((s) => s.from <= s.to);
  const phases = spans.map((span) => {
    const before = count(board);
    const taken = new Map<Region, number>(REGIONS.map((r) => [r, 0]));
    for (let k = span.from; k <= span.to; k++) {
      const m = line[k - 1];
      taken.set(regionOf(m.over), taken.get(regionOf(m.over))! + 1);
      board[m.from] = 0;
      board[m.over] = 0;
      board[m.to] = 1;
    }
    const after = count(board);
    const top = [...taken].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 2);
    const emptied = REGIONS.filter((r) => before.get(r)! > 0 && after.get(r) === 0);
    const parts = [`Moves ${span.from}–${span.to} take marbles mostly from the ${join(top.map(([r, n]) => `${r} (${n})`))}.`];
    if (emptied.length) parts.push(`${emptied.length === 1 ? "The" : "They empty the"} ${join(emptied)}${emptied.length === 1 ? " is emptied" : ""}.`);
    const pk = packages.filter((p) => p >= span.from && p <= span.to);
    if (pk.length) parts.push(`Catalyst packages (a marble jumps out and straight back) start at ${movesText(pk)}.`);
    const ce = cornerExits.filter((p) => p >= span.from && p <= span.to);
    if (ce.length) parts.push(`Corner marbles jump out at ${movesText(ce)}.`);
    const left = [...after].filter(([, n]) => n > 0).map(([r]) => r);
    if (span.to < line.length && left.length <= 3) parts.push(`What's left sits in the ${join(left)}.`);
    return { ...span, text: parts.join(" ") };
  });
  return { phases, packages, cornerExits };
}

/** One sentence on how a line finishes. */
export function finishNote(start: Cell, line: readonly Move[]): string {
  const board = startBoard(start);
  for (const m of line) {
    board[m.from] = 0;
    board[m.over] = 0;
    board[m.to] = 1;
  }
  const left = [...board.keys()].filter((i) => board[i]);
  if (left.length === 1) {
    const ends = finishingHoles(start).map(label);
    return `The last jump lands on ${label(left[0])}, one of ${label(start)}'s four possible finishing holes (${join(ends)}).`;
  }
  return `It ends with ${left.length} marbles, on ${join(left.map(label))}: the best this start allows.`;
}
