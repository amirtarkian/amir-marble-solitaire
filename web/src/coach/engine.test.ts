// Exercises engine.wasm's C ABI directly (run ./scripts/build-wasm.sh first).
import { beforeAll, describe, expect, test } from "bun:test";
import { parseLabel } from "../board/geometry";
import { Game, boardToBits } from "../game/state";

let w: any;
const bits = (...labels: string[]) => labels.reduce((b, l) => b | (1n << BigInt(parseLabel(l)!)), 0n);

beforeAll(async () => {
  const bytes = await Bun.file(new URL("../../public/engine.wasm", import.meta.url).pathname).arrayBuffer();
  w = (await WebAssembly.instantiate(bytes, {})).instance.exports;
});

describe("engine.wasm", () => {
  test("values of small endgames", () => {
    expect(w.value(bits("d4", "e4"), 1_000_000)).toBe(1);
    expect(w.value(bits("a4", "d4", "g4", "d7"), 1_000_000)).toBe(4);
    expect(w.can_reach(bits("d4", "e4"), 1, 1_000_000)).toBe(1);
  });

  test("best_line writes legal (from, to) pairs", () => {
    const g = new Game(17);
    for (let i = 0; i < 22; i++) g.play(g.legalMoves()[0]);
    const pos = boardToBits(g.board);
    const v = w.value(pos, 50_000_000);
    const n = w.best_line(pos, 50_000_000);
    expect(n).toBeGreaterThan(0);
    const out = new Uint8Array(w.memory.buffer, w.out_ptr(), n * 2);
    for (let i = 0; i < n; i++) g.play({ from: out[2 * i], over: (out[2 * i] + out[2 * i + 1]) / 2, to: out[2 * i + 1] });
    expect(g.isOver).toBe(true);
    expect(g.marbles).toBe(v);
  });

  test("a tiny budget reports -1 instead of guessing", () => {
    w.clear();
    expect(w.value(new Game(24).bits(), 100)).toBe(-1);
  });
});
