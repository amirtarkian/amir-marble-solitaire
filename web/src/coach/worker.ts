// Runs engine.wasm off the main thread. Every query is worked in node-budget slices;
// between slices the worker yields so new queries and cancellations get through, and it
// always resumes the highest-priority query. The engine's transposition table keeps the
// progress of a paused query, so switching back and forth costs little.

import type { FromWorker, Query, ToWorker } from "./protocol";

interface Engine {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  load_opening(ptr: number, len: number): number;
  value(pos: bigint, budget: number): number;
  can_reach(pos: bigint, t: number, budget: number): number;
  best_line(pos: bigint, budget: number): number;
  move_values(pos: bigint, budget: number): number;
  out_ptr(): number;
}

interface Job {
  id: number;
  priority: number;
  group: string;
  query: Query;
}

const SLICE = 1_500_000;
const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

let engine: Engine | null = null;
const queue: Job[] = [];
let pumping = false;

async function init(base: string) {
  try {
    const [wasm, opening] = await Promise.all([
      WebAssembly.instantiateStreaming(fetch(`${base}engine.wasm`), {}),
      fetch(`${base}data/opening.bin`).then((r) => {
        if (!r.ok) throw new Error(`opening table: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    const e = wasm.instance.exports as unknown as Engine;
    const ptr = e.alloc(opening.byteLength);
    new Uint8Array(e.memory.buffer, ptr, opening.byteLength).set(new Uint8Array(opening));
    const n = e.load_opening(ptr, opening.byteLength);
    if (n < 0) throw new Error("opening table is corrupt");
    engine = e;
    post({ type: "ready", openingEntries: n });
    pump();
  } catch (err) {
    post({ type: "failed", error: String(err) });
  }
}

const out = (e: Engine, len: number) => Array.from(new Uint8Array(e.memory.buffer, e.out_ptr(), len));

/** One slice of work; null when the budget ran out. */
function step(e: Engine, q: Query): number | number[] | null {
  switch (q.kind) {
    case "value": {
      const v = e.value(q.bits, SLICE);
      return v < 0 ? null : v;
    }
    case "canReach": {
      const r = e.can_reach(q.bits, q.t, SLICE);
      return r < 0 ? null : r;
    }
    case "bestLine": {
      const n = e.best_line(q.bits, SLICE);
      return n < 0 ? null : out(e, n * 2);
    }
    case "moveValues": {
      const n = e.move_values(q.bits, SLICE);
      return n < 0 ? null : out(e, n * 3);
    }
  }
}

async function pump() {
  if (pumping || !engine) return;
  pumping = true;
  while (queue.length) {
    queue.sort((a, b) => b.priority - a.priority || a.id - b.id);
    const job = queue[0];
    const result = step(engine, job.query);
    if (result !== null) {
      queue.splice(queue.indexOf(job), 1);
      post({ type: "result", id: job.id, result });
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  pumping = false;
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === "init") init(m.base);
  else if (m.type === "query") {
    queue.push({ id: m.id, priority: m.priority, group: m.group, query: m.query });
    pump();
  } else if (m.type === "cancel") {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].group === m.group) {
        post({ type: "cancelled", id: queue[i].id });
        queue.splice(i, 1);
      }
    }
  }
};
