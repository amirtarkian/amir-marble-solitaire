import { describe, expect, test } from "bun:test";
import { HOLES, parseLabel } from "../board/geometry";
import { makeMove } from "../game/state";
import { REGIONS, describeLine, findPackages, finishNote, regionOf } from "./line-notes";

const sol = await Bun.file(new URL("../../public/data/solutions.json", import.meta.url).pathname).json();
const lineOf = (hole: string) => {
  const h = sol.holes.find((x: { label: string }) => x.label === hole);
  return { start: h.cell as number, line: (h.line as [number, number][]).map(([f, t]) => makeMove(f, t)) };
};

describe("line notes", () => {
  test("regions cover the 37 holes as 6+6+6+6+4+9", () => {
    const sizes = REGIONS.map((r) => HOLES.filter((x) => regionOf(x) === r).length);
    expect(sizes).toEqual([6, 6, 6, 6, 4, 9]);
  });

  test("finds the three-marble purge as a package", () => {
    const at = (s: string) => parseLabel(s)!;
    const purge = [makeMove(at("c5"), at("c3")), makeMove(at("e4"), at("c4")), makeMove(at("c3"), at("c5"))];
    expect(findPackages(purge)).toEqual([1]);
  });

  test("describes a perfect game in three phases and names its finish", () => {
    const { start, line } = lineOf("d5");
    const notes = describeLine(start, line);
    expect(notes.phases.map((p) => p.name)).toEqual(["Opening", "Middle game", "Closing"]);
    for (const p of notes.phases) expect(p.text).toContain("take marbles mostly from");
    expect(finishNote(start, line)).toMatch(/^The last jump lands on (d6|d3|a3|g3)/);
  });
});
