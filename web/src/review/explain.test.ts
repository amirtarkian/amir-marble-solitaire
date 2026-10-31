import { describe, expect, test } from "bun:test";
import { parseLabel } from "../board/geometry";
import { makeMove } from "../game/state";
import { explain } from "./explain";

const at = (s: string) => parseLabel(s)!;
const board = (...cells: string[]) => {
  const b = new Uint8Array(49);
  for (const c of cells) b[at(c)] = 1;
  return b;
};

describe("explaining a costly move", () => {
  test("names a marble jumped into a corner that never leaves", () => {
    // c5 jumps over c6 into c7 (a corner); best play afterwards can't move it.
    const before = board("c5", "c6", "d4", "e4");
    const e = explain(before, makeMove(at("c5"), at("c7")), [makeMove(at("e4"), at("c4")), makeMove(at("c6"), at("c4"))], []);
    expect(e.stuck.map(String)).toContain(String(at("c7")));
    expect(e.reasons[0]).toContain("corner");
    expect(e.principle).toBe(3);
  });

  test("names a marble left alone", () => {
    const before = board("a4", "b4", "c4", "e2");
    // c4 jumps over b4 into a4? Not legal (a4 full). Use b4 over c4 into d4: leaves a4 alone.
    const e = explain(before, makeMove(at("b4"), at("d4")), [makeMove(at("a4"), at("c4"))], []);
    expect(e.reasons[0]).toContain("a4");
    expect(e.principle).toBe(5);
  });
});
