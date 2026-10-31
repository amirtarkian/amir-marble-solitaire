import { describe, expect, test } from "bun:test";
import { movesFrom } from "../game/state";
import { finishingHoles, UNJUMPABLE } from "./facts";
import { label, parseLabel } from "./geometry";

const L = (cells: number[]) => cells.map(label).sort();

describe("board facts (match the Rust engine)", () => {
  test("12 holes can never be jumped over", () => {
    expect(L([...UNJUMPABLE])).toEqual(["a3", "a5", "b2", "b6", "c1", "c7", "e1", "e7", "f2", "f6", "g3", "g5"]);
  });

  test("finishing holes per start", () => {
    expect(L(finishingHoles(parseLabel("d5")!))).toEqual(["a3", "d3", "d6", "g3"]);
    expect(L(finishingHoles(parseLabel("e7")!))).toEqual(["c1", "c4", "c7", "f4"]);
    expect(finishingHoles(parseLabel("d4")!)).toEqual([]);
    expect(finishingHoles(parseLabel("e5")!)).toEqual([]);
  });

  test("the three-marble purge clears a line and returns the catalyst", () => {
    // Line c4 d4 e4, catalyst c5, empty hole c3.
    const b = new Uint8Array(49);
    for (const s of ["c5", "c4", "d4", "e4"]) b[parseLabel(s)!] = 1;
    const play = (from: string, to: string) => {
      const m = movesFrom(b, parseLabel(from)!).find((x) => x.to === parseLabel(to));
      expect(m).toBeDefined();
      b[m!.from] = 0;
      b[m!.over] = 0;
      b[m!.to] = 1;
    };
    play("c5", "c3");
    play("e4", "c4");
    play("c3", "c5");
    expect([...b].map((v, i) => (v ? label(i) : null)).filter(Boolean)).toEqual(["c5"]);
  });
});
