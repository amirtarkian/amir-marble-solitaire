// Promise API over the coach worker. Values are facts about positions, so they are
// cached here and shared by every caller (hints, warnings, the review).

import type { Cell } from "../board/geometry";
import { type Move, makeMove } from "../game/state";
import type { FromWorker, Query, ToWorker } from "./protocol";

export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

export interface QueryOptions {
  /** Higher runs first. Interactive help uses 10, background analysis 0. */
  priority?: number;
  /** `cancel(group)` drops every pending query in the group. */
  group?: string;
}

export interface MoveValue {
  move: Move;
  value: number;
}

type Pending = { resolve: (r: number | number[]) => void; reject: (e: Error) => void };

export class Coach {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private values = new Map<bigint, number>();
  private constructor(private worker: Worker) {}

  /** Resolves to null if the engine cannot load; the game still works without a coach. */
  static create(): Promise<Coach | null> {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    } catch {
      return Promise.resolve(null);
    }
    const coach = new Coach(worker);
    return new Promise((resolve) => {
      worker.onmessage = (ev: MessageEvent<FromWorker>) => {
        const m = ev.data;
        if (m.type === "ready") resolve(coach);
        else if (m.type === "failed") {
          console.warn("coach unavailable:", m.error);
          worker.terminate();
          resolve(null);
        } else coach.onMessage(m);
      };
      worker.onerror = (e) => {
        console.warn("coach worker error:", e.message);
        resolve(null);
      };
      worker.postMessage({ type: "init", base: import.meta.env.BASE_URL } satisfies ToWorker);
    });
  }

  private onMessage(m: FromWorker) {
    if (m.type !== "result" && m.type !== "cancelled") return;
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.type === "result") p.resolve(m.result);
    else p.reject(new Cancelled());
  }

  private ask(query: Query, opts: QueryOptions = {}): Promise<number | number[]> {
    const id = this.nextId++;
    const msg: ToWorker = { type: "query", id, priority: opts.priority ?? 0, group: opts.group ?? "", query };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(msg);
    });
  }

  cancel(group: string) {
    this.worker.postMessage({ type: "cancel", group } satisfies ToWorker);
  }

  knownValue(bits: bigint): number | undefined {
    return this.values.get(bits);
  }

  /** Fewest marbles that can remain from this position. */
  async value(bits: bigint, opts?: QueryOptions): Promise<number> {
    const known = this.values.get(bits);
    if (known !== undefined) return known;
    const v = (await this.ask({ kind: "value", bits }, opts)) as number;
    this.values.set(bits, v);
    return v;
  }

  /** Can play from this position still end with at most `t` marbles? */
  async canReach(bits: bigint, t: number, opts?: QueryOptions): Promise<boolean> {
    const known = this.values.get(bits);
    if (known !== undefined) return known <= t;
    return ((await this.ask({ kind: "canReach", bits, t }, opts)) as number) === 1;
  }

  /** An optimal sequence of moves from this position to the end. */
  async bestLine(bits: bigint, opts?: QueryOptions): Promise<Move[]> {
    const flat = (await this.ask({ kind: "bestLine", bits }, opts)) as number[];
    const line: Move[] = [];
    for (let i = 0; i < flat.length; i += 2) line.push(makeMove(flat[i] as Cell, flat[i + 1] as Cell));
    return line;
  }

  /** Every legal move with the exact value of the position it leads to. */
  async moveValues(bits: bigint, opts?: QueryOptions): Promise<MoveValue[]> {
    const flat = (await this.ask({ kind: "moveValues", bits }, opts)) as number[];
    const out: MoveValue[] = [];
    for (let i = 0; i < flat.length; i += 3) {
      const move = makeMove(flat[i], flat[i + 1]);
      out.push({ move, value: flat[i + 2] });
      const child = bits & ~(1n << BigInt(move.from)) & ~(1n << BigInt(move.over)) | (1n << BigInt(move.to));
      this.values.set(child, flat[i + 2]);
    }
    return out;
  }
}
