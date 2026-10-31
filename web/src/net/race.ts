// Race-room state as a pure reducer, so every client derives the same standings from the
// same messages. The host is the earliest joiner still present (ties: lowest id); only
// the host's config/start/lobby messages count.

import type { Cell } from "../board/geometry";
import { Game, type WireMove, makeMove } from "../game/state";

export interface Player {
  id: string;
  name: string;
  joinedAt: number;
  round: number;
  moves: WireMove[];
  finished: { marbles: number; ms: number } | null;
  desynced: boolean;
}

export type Phase = "lobby" | "racing" | "results";

export interface RaceState {
  selfId: string;
  players: Record<string, Player>;
  phase: Phase;
  round: number;
  startHole: Cell;
  startAt: number | null;
}

export type RaceMessage =
  | { type: "hello"; name: string; joinedAt: number; round: number; moves: WireMove[]; finished: Player["finished"] }
  | { type: "config"; startHole: Cell }
  | { type: "start"; startHole: Cell; at: number; round: number }
  | { type: "move"; round: number; move: WireMove }
  | { type: "undo"; round: number }
  | { type: "finish"; round: number; marbles: number; ms: number }
  | { type: "lobby" };

export type RaceEvent = (RaceMessage & { from: string }) | { type: "leave"; from: string };

export function initialState(selfId: string, name: string, joinedAt: number, startHole: Cell = 18): RaceState {
  return {
    selfId,
    players: { [selfId]: { id: selfId, name, joinedAt, round: 0, moves: [], finished: null, desynced: false } },
    phase: "lobby",
    round: 0,
    startHole,
    startAt: null,
  };
}

export function hostId(s: RaceState): string {
  return Object.values(s.players).sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))[0].id;
}

export const isHost = (s: RaceState) => hostId(s) === s.selfId;

function withPlayer(s: RaceState, id: string, f: (p: Player) => Player): RaceState {
  const p = s.players[id];
  return p ? { ...s, players: { ...s.players, [id]: f(p) } } : s;
}

/** Moves are replayed from the start hole; an illegal one marks the player desynced. */
function validMoves(start: Cell, moves: WireMove[]): boolean {
  try {
    Game.replay(start, moves.map(([f, t]) => makeMove(f, t)));
    return true;
  } catch {
    return false;
  }
}

export function reduce(s: RaceState, ev: RaceEvent): RaceState {
  const fromHost = s.players[ev.from] !== undefined && hostId(s) === ev.from;
  switch (ev.type) {
    case "hello": {
      const prev = s.players[ev.from];
      const p: Player = {
        id: ev.from, name: ev.name.slice(0, 24) || "Player", joinedAt: ev.joinedAt, round: ev.round,
        moves: ev.moves, finished: ev.finished, desynced: false,
      };
      p.desynced = p.round === s.round && s.phase !== "lobby" && !validMoves(s.startHole, p.moves);
      return { ...s, players: { ...s.players, [ev.from]: prev ? { ...p, joinedAt: Math.min(prev.joinedAt, p.joinedAt) } : p } };
    }
    case "leave": {
      if (ev.from === s.selfId) return s;
      const players = { ...s.players };
      delete players[ev.from];
      return { ...s, players };
    }
    case "config":
      return fromHost && s.phase !== "racing" ? { ...s, startHole: ev.startHole } : s;
    case "start": {
      if (!fromHost || ev.round <= s.round) return s;
      const players: Record<string, Player> = {};
      for (const p of Object.values(s.players)) players[p.id] = { ...p, round: ev.round, moves: [], finished: null, desynced: false };
      return { ...s, players, phase: "racing", round: ev.round, startHole: ev.startHole, startAt: ev.at };
    }
    case "move":
      if (ev.round !== s.round) return s;
      return withPlayer(s, ev.from, (p) => {
        if (p.finished || p.desynced) return p;
        const moves = [...p.moves, ev.move];
        return { ...p, moves, desynced: !validMoves(s.startHole, moves) };
      });
    case "undo":
      if (ev.round !== s.round) return s;
      return withPlayer(s, ev.from, (p) => (p.finished ? p : { ...p, moves: p.moves.slice(0, -1) }));
    case "finish": {
      if (ev.round !== s.round) return s;
      const next = withPlayer(s, ev.from, (p) => ({ ...p, finished: { marbles: ev.marbles, ms: ev.ms } }));
      const racers = Object.values(next.players).filter((p) => p.round === next.round);
      return racers.every((p) => p.finished) ? { ...next, phase: "results" } : next;
    }
    case "lobby":
      return fromHost ? { ...s, phase: "lobby", startAt: null } : s;
  }
}

/** Marbles a player has left right now (36 at the start). */
export const marblesLeft = (p: Player) => 36 - p.moves.length;

/** Finished players first (fewest marbles, then fastest), then everyone else by marbles left. */
export function standings(s: RaceState): Player[] {
  const racers = Object.values(s.players).filter((p) => p.round === s.round && s.round > 0);
  return racers.sort((a, b) => {
    if (a.finished && b.finished) return a.finished.marbles - b.finished.marbles || a.finished.ms - b.finished.ms;
    if (a.finished || b.finished) return a.finished ? -1 : 1;
    return marblesLeft(a) - marblesLeft(b);
  });
}
