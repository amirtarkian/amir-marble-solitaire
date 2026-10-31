// Grading a finished game: what kind of move each one was, how skilful the game was once
// position difficulty is taken into account, and a chess-style performance rating.
//
// Difficulty comes from the solver: at each position we know how many legal moves keep
// the best possible finish (`good` of `total`). Finding the one good move out of nine
// says much more than playing one of eight good moves.

export interface Analysis {
  /** Best possible finish after i moves, i = 0..n. */
  values: number[];
  /** For the position before move i+1: moves that keep its best finish, and all moves. */
  good: number[];
  total: number[];
}

export type MoveKind = "only" | "best" | "forced" | "helped" | "mistake" | "blunder";

export interface GradedMove {
  kind: MoveKind;
  cost: number;
  good: number;
  total: number;
  helped: boolean;
}

export const KIND_LABEL: Record<MoveKind, string> = {
  only: "Only move",
  best: "Best",
  forced: "Forced",
  helped: "Coach-assisted",
  mistake: "Mistake",
  blunder: "Blunder",
};

/** `help` holds the indices of positions where the coach showed a move or a line. */
export function gradeMoves(a: Analysis, help: ReadonlySet<number>): GradedMove[] {
  return a.good.map((good, i) => {
    const cost = a.values[i + 1] - a.values[i];
    const total = a.total[i];
    const helped = help.has(i);
    let kind: MoveKind;
    if (cost >= 2) kind = "blunder";
    else if (cost === 1) kind = "mistake";
    else if (total <= 1) kind = "forced";
    else if (helped) kind = "helped";
    else if (good === 1 && total >= 3) kind = "only";
    else kind = "best";
    return { kind, cost, good, total, helped };
  });
}

/**
 * Probability `s` that this player sees the right move, as opposed to guessing. A guess
 * still lands on a good move `good/total` of the time, so a move is found with
 * probability s + (1 - s)·g. Maximum likelihood over the informative moves, with a mild
 * Beta(2, 2) prior so one short game can't claim 0% or 100%. Coach-assisted moves count
 * as not found.
 */
export function estimateSkill(moves: readonly GradedMove[]): number {
  const obs = moves
    .filter((m) => m.total > 1 && m.good < m.total)
    .map((m) => ({ g: m.good / m.total, found: m.cost === 0 && !m.helped }));
  let best = 0.5, bestL = -Infinity;
  for (let s = 0.0025; s < 1; s += 0.005) {
    let l = Math.log(s) + Math.log(1 - s);
    for (const o of obs) l += o.found ? Math.log(s + (1 - s) * o.g) : Math.log((1 - s) * (1 - o.g));
    if (l > bestL) [best, bestL] = [s, l];
  }
  return best;
}

/** Chess-style performance rating: skill sets the base, takebacks cost points. */
export function performanceRating(skill: number, takebacks: number): number {
  const r = 400 + 2000 * skill - Math.min(300, 25 * takebacks);
  return Math.round(Math.min(2800, Math.max(100, r)) / 10) * 10;
}

export function ratingTitle(r: number): string {
  if (r < 800) return "Novice";
  if (r < 1200) return "Beginner";
  if (r < 1600) return "Intermediate";
  if (r < 2000) return "Club player";
  if (r < 2300) return "Expert";
  return "Master";
}

/**
 * Odds of finishing with 1, 2, 3 or 4+ marbles from each position of the game, for a
 * player of skill `s`, along the road the game actually took: at move j a slip happens
 * with probability (1 - s)·(1 - good_j/total_j), and each slip costs one marble. Hard
 * stretches (few good moves) pull the odds down; easy ones barely move them.
 */
export function pathOdds(a: Analysis, s: number, over: boolean): ([number, number, number, number] | null)[] {
  const n = a.good.length;
  const bucket = (f: number) => Math.min(Math.max(f, 1), 4) - 1;
  const out: ([number, number, number, number] | null)[] = [];
  for (let i = 0; i <= n; i++) {
    const v = a.values[i];
    const p: [number, number, number, number] = [0, 0, 0, 0];
    if (v === undefined || v === null) {
      out.push(null);
      continue;
    }
    if (i === n) {
      if (over) p[bucket(36 - n)] = 1;
      else p[bucket(v)] = 1;
      out.push(p);
      continue;
    }
    // Poisson-binomial distribution of the number of slips over moves i..n-1.
    let dist = [1];
    let known = true;
    for (let j = i; j < n; j++) {
      if (!a.total[j]) {
        known = false;
        break;
      }
      const q = (1 - s) * (1 - a.good[j] / a.total[j]);
      const next = new Array(dist.length + 1).fill(0);
      dist.forEach((x, m) => {
        next[m] += x * (1 - q);
        next[m + 1] += x * q;
      });
      dist = next;
    }
    if (!known) {
      out.push(null);
      continue;
    }
    dist.forEach((x, m) => (p[bucket(v + m)] += x));
    out.push(p);
  }
  return out;
}

/** Reference players for the odds graph, on the same scale as performanceRating. */
export const SKILL_PRESETS = [
  { id: "beginner", name: "Beginner", skill: 0.25 },
  { id: "club", name: "Club", skill: 0.55 },
  { id: "expert", name: "Expert", skill: 0.85 },
];

export const KIND_COLOR: Record<MoveKind, string> = {
  only: "#b48cff",
  best: "#7fd18b",
  forced: "#8a8f98",
  helped: "#6aa9ff",
  mistake: "#f2c14e",
  blunder: "#e5603c",
};
