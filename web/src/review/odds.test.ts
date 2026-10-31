import { describe, expect, test } from "bun:test";
import { accuracyOf, finishOdds } from "./odds";

const sum = (p: number[]) => p.reduce((a, b) => a + b, 0);

describe("finish odds", () => {
  test("probabilities sum to one", () => {
    for (const [best, marbles, acc] of [[1, 36, 0.9], [2, 20, 0.5], [3, 5, 0.97], [1, 1, 0.8]]) {
      expect(sum(finishOdds(best, marbles, acc).p)).toBeCloseTo(1, 9);
    }
  });

  test("a finish better than the best possible gets zero", () => {
    const { p } = finishOdds(2, 30, 0.9);
    expect(p[0]).toBe(0);
  });

  test("perfect accuracy means you get the best possible finish", () => {
    expect(finishOdds(1, 30, 1).p).toEqual([1, 0, 0, 0]);
    expect(finishOdds(2, 30, 1).p).toEqual([0, 1, 0, 0]);
  });

  test("matches the binomial: d5 start at 92% accuracy", () => {
    const { p } = finishOdds(1, 36, 0.92);
    expect(p[0]).toBeCloseTo(0.92 ** 35, 9);
    expect(p[1]).toBeCloseTo(35 * 0.08 * 0.92 ** 34, 9);
  });

  test("a finished game is certain", () => {
    expect(finishOdds(1, 3, 0.9, true).p).toEqual([0, 0, 1, 0]);
    expect(finishOdds(1, 7, 0.9, true).p).toEqual([0, 0, 0, 1]);
  });

  test("accuracy is smoothed", () => {
    expect(accuracyOf([0, 0, 0, 0])).toBeCloseTo(5 / 6);
    expect(accuracyOf([0, 1, null])).toBeCloseTo(2 / 4);
  });
});
