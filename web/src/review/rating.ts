// Your running rating across solo games, kept in this browser.

import { storageGet, storageSet } from "../app";

export interface RatingState {
  rating: number;
  games: number;
  history: { perf: number; at: number }[];
}

const KEY = "rating-v1";

export function loadRating(): RatingState | null {
  try {
    const s = JSON.parse(storageGet(KEY) ?? "null");
    return s && typeof s.rating === "number" ? s : null;
  } catch {
    return null;
  }
}

/** Moves the rating toward this game's performance; early games count for more. */
export function applyPerformance(perf: number): { before: number | null; after: number } {
  const s = loadRating();
  const before = s?.rating ?? null;
  const games = s?.games ?? 0;
  const weight = Math.max(0.2, 1 / (games + 1));
  const after = Math.round(before === null ? perf : before + (perf - before) * weight);
  const history = [...(s?.history ?? []), { perf, at: Date.now() }].slice(-30);
  storageSet(KEY, JSON.stringify({ rating: after, games: games + 1, history } satisfies RatingState));
  return { before, after };
}
