import { describe, expect, test } from "bun:test";
import { type Analysis, estimateSkill, gradeMoves, pathOdds, performanceRating, ratingTitle } from "./grade";

const game: Analysis = {
  values: [1, 1, 1, 2, 2],
  good: [3, 1, 2, 1],
  total: [4, 6, 5, 1],
};

describe("grading", () => {
  test("classifies moves", () => {
    const kinds = gradeMoves(game, new Set([2])).map((m) => m.kind);
    expect(kinds).toEqual(["best", "only", "mistake", "forced"]);
    expect(gradeMoves(game, new Set([1])).map((m) => m.kind)[1]).toBe("helped");
  });

  test("finding hard moves rates higher than finding easy ones", () => {
    const easy = gradeMoves({ values: [1, 1, 1, 1], good: [7, 7, 7], total: [8, 8, 8] }, new Set());
    const hard = gradeMoves({ values: [1, 1, 1, 1], good: [1, 1, 1], total: [8, 8, 8] }, new Set());
    expect(estimateSkill(hard)).toBeGreaterThan(estimateSkill(easy));
  });

  test("coach help lowers the estimate", () => {
    const a: Analysis = { values: [1, 1, 1, 1, 1], good: [1, 1, 1, 1], total: [6, 6, 6, 6] };
    expect(estimateSkill(gradeMoves(a, new Set([0, 1])))).toBeLessThan(estimateSkill(gradeMoves(a, new Set())));
  });

  test("rating scale and titles", () => {
    expect(performanceRating(0.5, 0)).toBe(1400);
    expect(performanceRating(0.5, 4)).toBe(1300);
    expect(ratingTitle(1400)).toBe("Intermediate");
    expect(ratingTitle(2350)).toBe("Master");
  });
});

describe("path odds", () => {
  test("sum to one, and hard stretches lower the chance of the best finish", () => {
    const easy = pathOdds({ values: [1, 1, 1], good: [9, 9], total: [10, 10] }, 0.5, false);
    const hard = pathOdds({ values: [1, 1, 1], good: [1, 1], total: [10, 10] }, 0.5, false);
    for (const p of [...easy, ...hard]) expect(p!.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(hard[0]![0]).toBeLessThan(easy[0]![0]);
  });

  test("the finished position is certain", () => {
    const odds = pathOdds(game, 0.7, true);
    expect(odds[4]).toEqual([0, 0, 0, 1]); // 36 - 4 moves = 32 marbles left
  });

  test("unknown difficulty leaves gaps instead of guessing", () => {
    const odds = pathOdds({ values: [1, 1, 1], good: [1, 0], total: [3, 0] }, 0.5, false);
    expect(odds[0]).toBeNull();
    expect(odds[1]).toBeNull();
  });
});
