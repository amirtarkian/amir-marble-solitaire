// The offline solver's results (web/public/data/solutions.json).

import type { Cell } from "../board/geometry";
import { type Move, makeMove } from "../game/state";

export interface HoleSolution {
  label: string;
  cell: Cell;
  orbit: string;
  best: number;
  line: [Cell, Cell][];
  /** The easiest perfect line to replicate, and (good, legal) moves at each of its steps. */
  easy_line?: [Cell, Cell][];
  easy_steps?: [number, number][];
}

export interface LevelStat {
  marbles: number;
  positions: number;
  hard: number;
  on_track: number;
}

export interface OrbitStats {
  rep: string;
  best: number;
  reachable: number;
  /** Chance an average player (skill 0.5, about 1400) plays this start perfectly. */
  p_perfect?: number;
  levels: LevelStat[];
}

export interface Solutions {
  holes: HoleSolution[];
  orbits: OrbitStats[];
  opening_moves: number;
}

let cached: Promise<Solutions | null> | null = null;

export function loadSolutions(): Promise<Solutions | null> {
  cached ??= fetch(`${import.meta.env.BASE_URL}data/solutions.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Solutions>) : null))
    .catch(() => null);
  return cached;
}

export const holeSolution = (s: Solutions, cell: Cell) => s.holes.find((h) => h.cell === cell);
export const lineMoves = (h: HoleSolution): Move[] => h.line.map(([f, t]) => makeMove(f, t));
export const easyMoves = (h: HoleSolution): Move[] => (h.easy_line ?? h.line).map(([f, t]) => makeMove(f, t));
export const orbitStats = (s: Solutions, h: HoleSolution) => s.orbits.find((o) => o.rep === h.orbit)!;

/** Heat-map colour for a best finish of n marbles. */
export const heatColor = (n: number) => (n <= 1 ? "#f2c14e" : n === 2 ? "#5fb3a1" : "#8a8f98");
