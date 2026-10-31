import { type Cell, HOLES, isHole, rc } from "../board/geometry";

export interface Move {
  from: Cell;
  over: Cell;
  to: Cell;
}

export type WireMove = [from: Cell, to: Cell];

export const makeMove = (from: Cell, to: Cell): Move => ({ from, over: (from + to) / 2, to });
export const toWire = (m: Move): WireMove => [m.from, m.to];
export const sameMove = (a: Move, b: Move) => a.from === b.from && a.to === b.to;

const STEPS: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];

export function movesFrom(board: Uint8Array, from: Cell): Move[] {
  if (!board[from]) return [];
  const [r, c] = rc(from);
  const out: Move[] = [];
  for (const [dr, dc] of STEPS) {
    const r2 = r + 2 * dr, c2 = c + 2 * dc;
    if (r2 < 0 || r2 > 6 || c2 < 0 || c2 > 6) continue;
    const over = (r + dr) * 7 + c + dc, to = r2 * 7 + c2;
    if (isHole(to) && board[over] && !board[to]) out.push({ from, over, to });
  }
  return out;
}

export function legalMoves(board: Uint8Array): Move[] {
  return HOLES.flatMap((h) => movesFrom(board, h));
}

export function startBoard(start: Cell): Uint8Array {
  const b = new Uint8Array(49);
  for (const h of HOLES) b[h] = 1;
  b[start] = 0;
  return b;
}

export function boardToBits(board: Uint8Array): bigint {
  let bits = 0n;
  for (const h of HOLES) if (board[h]) bits |= 1n << BigInt(h);
  return bits;
}

export function bitsToBoard(bits: bigint): Uint8Array {
  const b = new Uint8Array(49);
  for (const h of HOLES) b[h] = Number((bits >> BigInt(h)) & 1n);
  return b;
}

export function countMarbles(board: Uint8Array): number {
  let n = 0;
  for (const h of HOLES) n += board[h];
  return n;
}

/** One game from a chosen starting hole, with undo/redo. */
export class Game {
  readonly board: Uint8Array;
  readonly history: Move[] = [];
  private future: Move[] = [];

  constructor(readonly start: Cell) {
    if (!isHole(start)) throw new Error(`not a hole: ${start}`);
    this.board = startBoard(start);
  }

  static replay(start: Cell, moves: readonly (Move | WireMove)[]): Game {
    const g = new Game(start);
    for (const m of moves) g.play(Array.isArray(m) ? makeMove(m[0], m[1]) : m);
    return g;
  }

  get marbles(): number {
    return countMarbles(this.board);
  }

  get isOver(): boolean {
    return this.legalMoves().length === 0;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  legalMoves(): Move[] {
    return legalMoves(this.board);
  }

  movesFrom(cell: Cell): Move[] {
    return movesFrom(this.board, cell);
  }

  isLegal(m: Move): boolean {
    return this.movesFrom(m.from).some((x) => sameMove(x, m));
  }

  play(m: Move): void {
    if (!this.isLegal(m)) throw new Error(`illegal move ${m.from}->${m.to}`);
    this.apply(m);
    this.history.push(m);
    this.future = [];
  }

  undo(): Move | null {
    const m = this.history.pop();
    if (!m) return null;
    this.board[m.from] = 1;
    this.board[m.over] = 1;
    this.board[m.to] = 0;
    this.future.push(m);
    return m;
  }

  redo(): Move | null {
    const m = this.future.pop();
    if (!m) return null;
    this.apply(m);
    this.history.push(m);
    return m;
  }

  bits(): bigint {
    return boardToBits(this.board);
  }

  private apply(m: Move) {
    this.board[m.from] = 0;
    this.board[m.over] = 0;
    this.board[m.to] = 1;
  }
}
