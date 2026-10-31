// Odds of each finish for the review graph.
//
// Solitaire has no luck, so "probability" needs a model of the player. Ours: from a
// position whose best possible finish is `best`, about `marbles - best` moves remain,
// each move is a slip with probability `1 - accuracy`, and every slip costs one marble.
// The finish is then `best + Binomial(remaining, 1 - accuracy)`. The solver supplies the
// exact `best`; the model only spreads it out.

export interface Odds {
  /** Chance of finishing with exactly 1, 2, 3, and 4 or more marbles. */
  p: [number, number, number, number];
}

export interface SkillPreset {
  id: string;
  name: string;
  accuracy: number;
}

export const PRESETS: SkillPreset[] = [
  { id: "beginner", name: "Beginner", accuracy: 0.8 },
  { id: "club", name: "Club", accuracy: 0.9 },
  { id: "expert", name: "Expert", accuracy: 0.97 },
];

/** Accuracy from graded moves, smoothed so a short or perfect game isn't treated as 0% or 100%. */
export function accuracyOf(costs: readonly (number | null)[]): number {
  const graded = costs.filter((c): c is number => c !== null);
  const good = graded.filter((c) => c === 0).length;
  return (good + 1) / (graded.length + 2);
}

export function finishOdds(best: number, marbles: number, accuracy: number, over = false): Odds {
  const p: [number, number, number, number] = [0, 0, 0, 0];
  const bucket = (finish: number) => Math.min(Math.max(finish, 1), 4) - 1;
  if (over) {
    p[bucket(marbles)] = 1;
    return { p };
  }
  const n = Math.max(0, marbles - best);
  const e = Math.min(Math.max(1 - accuracy, 0), 1);
  // Binomial(n, e), built term by term.
  let term = (1 - e) ** n;
  for (let j = 0; j <= n; j++) {
    p[bucket(best + j)] += term;
    term = e < 1 ? (term * (n - j) / (j + 1)) * (e / (1 - e)) : j === n - 1 ? 1 : 0;
  }
  const total = p[0] + p[1] + p[2] + p[3];
  return { p: p.map((x) => x / total) as Odds["p"] };
}
