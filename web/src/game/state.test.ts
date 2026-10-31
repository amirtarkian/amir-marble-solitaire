import { describe, expect, test } from "bun:test";
import { CENTRE, HOLES, label, parseLabel } from "../board/geometry";
import { Game, bitsToBoard, makeMove } from "./state";

describe("board geometry", () => {
  test("37 holes, labels match the engine", () => {
    expect(HOLES.length).toBe(37);
    expect(label(CENTRE)).toBe("d4");
    expect(label(2)).toBe("c7");
    expect(parseLabel("e1")).toBe(46);
    expect(parseLabel("a1")).toBeNull();
  });
});

describe("Game", () => {
  test("centre start has 36 marbles and 4 moves", () => {
    const g = new Game(CENTRE);
    expect(g.marbles).toBe(36);
    expect(g.legalMoves().length).toBe(4);
  });

  test("play, undo and redo round-trip", () => {
    const g = new Game(CENTRE);
    const before = g.bits();
    const m = g.legalMoves()[0];
    g.play(m);
    expect(g.marbles).toBe(35);
    expect(g.board[m.to]).toBe(1);
    expect(g.board[m.over]).toBe(0);
    expect(g.undo()).toEqual(m);
    expect(g.bits()).toBe(before);
    expect(g.redo()).toEqual(m);
    expect(g.marbles).toBe(35);
    expect(g.canRedo).toBe(false);
  });

  test("a new move clears the redo stack", () => {
    const g = new Game(CENTRE);
    const [a, b] = g.legalMoves();
    g.play(a);
    g.undo();
    g.play(b);
    expect(g.canRedo).toBe(false);
  });

  test("illegal moves throw", () => {
    const g = new Game(CENTRE);
    expect(() => g.play(makeMove(0 + 2, 2 + 14))).toThrow();
  });

  test("replay equals manual play, and bits round-trip", () => {
    const g = new Game(17);
    for (let i = 0; i < 6; i++) g.play(g.legalMoves()[i % g.legalMoves().length]);
    const r = Game.replay(17, g.history);
    expect(r.bits()).toBe(g.bits());
    expect(Array.from(bitsToBoard(g.bits()))).toEqual(Array.from(g.board));
  });

  test("bits use the engine's bit order", () => {
    const g = new Game(CENTRE);
    expect((g.bits() >> 24n) & 1n).toBe(0n);
    expect(g.bits() & (1n << 2n)).toBe(1n << 2n);
  });
});
