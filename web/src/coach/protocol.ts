// Messages between the page and the coach worker.

export type Query =
  | { kind: "value"; bits: bigint }
  | { kind: "canReach"; bits: bigint; t: number }
  | { kind: "bestLine"; bits: bigint }
  | { kind: "moveValues"; bits: bigint }
  | { kind: "grades"; bits: bigint };

export type ToWorker =
  | { type: "init"; base: string }
  | { type: "query"; id: number; priority: number; group: string; query: Query }
  | { type: "cancel"; group: string };

export type FromWorker =
  | { type: "ready"; openingEntries: number }
  | { type: "failed"; error: string }
  | { type: "result"; id: number; result: number | number[] }
  | { type: "cancelled"; id: number };
