import { describe, expect, test } from "bun:test";
import { Game, type WireMove, toWire } from "../game/state";
import { type RaceState, hostId, initialState, reduce, standings } from "./race";

const hello = (from: string, joinedAt: number, name = from) =>
  ({ type: "hello", from, name, joinedAt, round: 0, moves: [], finished: null }) as const;

function room(): RaceState {
  let s = initialState("me", "Me", 100);
  s = reduce(s, hello("bob", 200));
  s = reduce(s, hello("amy", 300));
  return s;
}

function line(start: number, n: number): WireMove[] {
  const g = new Game(start);
  for (let i = 0; i < n; i++) g.play(g.legalMoves()[0]);
  return g.history.map(toWire);
}

describe("race reducer", () => {
  test("earliest joiner hosts; host hands over when they leave", () => {
    let s = room();
    expect(hostId(s)).toBe("me");
    s = reduce({ ...s, selfId: "bob" }, { type: "leave", from: "me" });
    expect(hostId(s)).toBe("bob");
  });

  test("only the host can start a race or change the hole", () => {
    let s = room();
    s = reduce(s, { type: "start", from: "bob", startHole: 24, at: 1, round: 1 });
    expect(s.phase).toBe("lobby");
    s = reduce(s, { type: "config", from: "amy", startHole: 3 });
    expect(s.startHole).toBe(18);
    s = reduce(s, { type: "start", from: "me", startHole: 24, at: 1, round: 1 });
    expect(s.phase).toBe("racing");
    expect(s.startHole).toBe(24);
  });

  test("moves are validated by replaying them", () => {
    let s = reduce(room(), { type: "start", from: "me", startHole: 24, at: 1, round: 1 });
    const [m1, m2] = line(24, 2);
    s = reduce(s, { type: "move", from: "bob", round: 1, move: m1 });
    s = reduce(s, { type: "move", from: "bob", round: 1, move: m2 });
    expect(s.players.bob.moves.length).toBe(2);
    expect(s.players.bob.desynced).toBe(false);
    s = reduce(s, { type: "move", from: "amy", round: 1, move: [0, 2] });
    expect(s.players.amy.desynced).toBe(true);
    s = reduce(s, { type: "undo", from: "bob", round: 1 });
    expect(s.players.bob.moves).toEqual([m1]);
  });

  test("messages from an old round are ignored", () => {
    let s = reduce(room(), { type: "start", from: "me", startHole: 24, at: 1, round: 2 });
    s = reduce(s, { type: "move", from: "bob", round: 1, move: line(24, 1)[0] });
    expect(s.players.bob.moves.length).toBe(0);
  });

  test("standings: fewest marbles wins, ties go to the faster finish", () => {
    let s = reduce(room(), { type: "start", from: "me", startHole: 24, at: 1, round: 1 });
    s = reduce(s, { type: "finish", from: "bob", round: 1, marbles: 3, ms: 90_000 });
    s = reduce(s, { type: "finish", from: "amy", round: 1, marbles: 2, ms: 120_000 });
    expect(s.phase).toBe("racing");
    s = reduce(s, { type: "finish", from: "me", round: 1, marbles: 3, ms: 60_000 });
    expect(s.phase).toBe("results");
    expect(standings(s).map((p) => p.id)).toEqual(["amy", "me", "bob"]);
  });

  test("the host can send everyone back to the lobby", () => {
    let s = reduce(room(), { type: "start", from: "me", startHole: 24, at: 1, round: 1 });
    s = reduce(s, { type: "lobby", from: "me" });
    expect(s.phase).toBe("lobby");
  });
});
