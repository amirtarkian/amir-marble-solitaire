# Marble Solitaire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 3D web app for 37-hole French marble solitaire with an exact coach, a
solutions explorer and online race rooms, deployed to GitHub Pages.

**Architecture:** A Rust `engine` crate holds rules, symmetry, position class and exact
search. A native `solver` binary exhaustively solves all 8 starts and writes
`solutions.json` plus an opening table of hard early positions. The same engine compiles
to `engine.wasm` (raw C ABI) and runs in a Web Worker as the coach. A Bun + Vite +
TypeScript + Three.js app renders the board and talks to friends over Trystero WebRTC.

**Tech Stack:** Rust 1.95 (+ rayon), wasm32-unknown-unknown, Bun 1.3, Vite, TypeScript,
Three.js, Trystero, GitHub Actions + Pages.

Spec: `docs/superpowers/specs/2026-10-31-marble-solitaire-design.md`

---

## Shared definitions (all tasks use these names)

- Cell index `i = r*7 + c`, `r,c ∈ 0..7`; valid iff `|r-3| + |c-3| <= 4`. 37 valid cells.
- Position: Rust `u64` / TS `bigint` with bit `i` set when cell `i` holds a marble.
- Move: `{ from, over, to }` with `over = (from + to) / 2`; on the wire, `(from, to)`.
- Labels: column letter `a..g` = `c`, row number `7 - r` (so `d4` is the centre, `r=3,c=3`).
- Symmetry ids 0..7: id, rot90 `(c,6-r)`, rot180, rot270 `(6-c,r)`, mirror `(r,6-c)`,
  flip `(6-r,c)`, transpose `(c,r)`, anti-transpose `(6-c,6-r)`.
- Position class: 4 bits = parities of `nA0+nA1`, `nA1+nA2`, `nB0+nB1`, `nB1+nB2`, where
  `nAk` = marbles with `(r+c) % 3 == k`, `nBk` = marbles with `(r-c) mod 3 == k`.
- Value of a position: fewest marbles that can remain when no jump is possible.

## File map

```
Cargo.toml                    workspace: engine, solver, wasm
engine/src/lib.rs             re-exports
engine/src/board.rs           cells, masks, move generation, apply
engine/src/symmetry.rs        8 transforms (row lookup tables), canon()
engine/src/class.rs           position class + lower bound
engine/src/search.rs          Solver: TT, can_reach, value, best_line, budgets
engine/src/opening.rs         opening-table encode/decode + lookup
engine/tests/*.rs             integration tests
solver/src/main.rs            exhaustive per-start solve, writes web/public/data
wasm/src/lib.rs               C-ABI exports for the browser
web/index.html, web/src/...   app (see Tasks 6-12)
.github/workflows/pages.yml   build wasm + web, deploy Pages
```

---

### Task 1: Workspace + board + move generation

**Files:** `Cargo.toml`, `engine/Cargo.toml`, `engine/src/{lib,board}.rs`, `engine/tests/board.rs`

- [ ] Tests first: `VALID.count_ones() == 37`; full board minus centre has exactly 4
      legal moves; full board minus `c1`-type hole has the expected count; applying a
      move then checking marbles = n-1; every generated move has from/over/to valid and
      collinear; the shift-based generator agrees with a brute-force generator over
      random positions.
- [ ] Implement `VALID`, `FROM_{E,W,S,N}` masks (const fns), `moves(p) -> MoveIter`,
      `apply(p, m)`, `has_moves(p)`, `label(i)`.
      Shift rules: E `p & p>>1 & e>>2 & FROM_E`; W `p & p<<1 & e<<2 & FROM_W`;
      S `p & p>>7 & e>>14 & FROM_S`; N `p & p<<7 & e<<14 & FROM_N`, `e = VALID & !p`.
- [ ] `cargo test -p engine` passes. Commit.

### Task 2: Symmetry + position class

**Files:** `engine/src/{symmetry,class}.rs`, `engine/tests/symmetry.rs`

- [ ] Tests: each transform maps VALID→VALID and is a bijection; group closes (composing
      any two equals one of the eight); `canon(transform(t,p)) == canon(p)` for random p;
      class is invariant under every move along random playouts; `lower_bound(centre
      start) == 2` (centre start cannot finish with one marble).
- [ ] Implement `ROW_T[8][7][128]` const tables, `transform(t,p)`, `canon(p)`,
      `canon_with_t(p)`; `CLASS_MASK_A/B[3]`, `class(p)`, `MIN_MARBLES_FOR_CLASS[16]`
      (brute force over 1-3 cells, non-empty), `lower_bound(p)`.
- [ ] Tests pass. Commit.

### Task 3: Exact search

**Files:** `engine/src/search.rs`, `engine/tests/search.rs`

- [ ] API: `Solver::new()`, `with_budget(nodes)`, `value(p) -> Result<u8, OutOfBudget>`,
      `can_reach(p, t) -> Result<bool, OutOfBudget>`, `best_line(p) -> Result<Vec<Move>,_>`,
      `set_opening(OpeningTable)`, `clear()`, `nodes()`.
      TT: `HashMap<u64 canon, (lb: u8, ub: u8)>` with Fx-style hasher, size cap.
- [ ] Tests: values on hand-made endgames (2 adjacent marbles with a hole → 1; isolated
      marbles → count); `best_line` replays legally and ends at `value` marbles; a known
      solvable start (search all 37 holes, at least one solves to 1) — record which.
- [ ] Tests pass. Commit.

### Task 4: Exhaustive solver + opening table

**Files:** `solver/Cargo.toml`, `solver/src/main.rs`, `engine/src/opening.rs`,
`engine/tests/opening.rs`

- [ ] Opening format: magic `MSOP`, u8 version=1, u8 depth N, u32 count, varint deltas of
      sorted 37-bit compact keys (pext of VALID bits), then packed 4-bit values.
      Store only positions whose value != `lower_bound(p)`; absent ⇒ value = lower bound
      (valid because every queried position is reachable from a single-vacancy start).
      Round-trip test.
- [ ] Solver: per orbit representative (8 cells): forward levels (rayon chunked
      children → par_sort_unstable → dedup), backward values (binary search children in
      previous level). Print per-level counts, timings, "hard" counts.
- [ ] Check: centre start total reachable == 374,349,517 and value == 2.
- [ ] Measure live-search cost by depth (sample positions per level, time `value()` with
      empty TT) to pick N; write `web/public/data/opening.bin` and `solutions.json`
      (per hole: label, orbit, best, optimal line, level counts).
- [ ] Cross-check: live `Solver::value` equals exhaustive values on 2,000 sampled
      positions from deep levels. Commit data + code.

### Task 5: WASM build

**Files:** `wasm/Cargo.toml`, `wasm/src/lib.rs`, `scripts/build-wasm.sh`

- [ ] Exports: `alloc(len)->ptr`, `load_opening(ptr,len)->i32`, `value(pos:u64,
      budget:u32)->i32` (-1 = out of budget), `best_line(pos,budget)->i32` (writes
      `from,to` bytes to `out_ptr()`), `move_values(pos,budget)->i32` (writes
      `from,to,value` triples), `out_ptr()`, `clear()`.
- [ ] `rustup target add wasm32-unknown-unknown`; script builds release with
      `opt-level=3, lto, panic=abort` and copies to `web/public/engine.wasm`.
- [ ] Smoke test in Bun: instantiate wasm, `value(centre start)` on a mid-game position
      matches native. Commit.

### Task 6: Web scaffold, geometry, rules mirror

**Files:** `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`,
`web/index.html`, `web/src/board/geometry.ts`, `web/src/game/state.ts`,
`web/src/game/state.test.ts`

- [ ] `Game` API: `new Game(start)`, `board: Uint8Array(49)`, `history`, `future`,
      `legalMoves()`, `movesFrom(cell)`, `play(m)`, `undo()`, `redo()`, `marbles`,
      `isOver`, `bits(): bigint`, `static replay(start, moves)`, `static fromBits()`.
- [ ] Tests (`bun test`): centre start has 4 moves; play/undo/redo round trip; illegal
      move throws; replay equals manual play; bits() matches Rust convention. Commit.

### Task 7: Coach worker + client

**Files:** `web/src/coach/worker.ts`, `web/src/coach/client.ts`, `web/src/coach/protocol.ts`

- [ ] Worker loads `engine.wasm` + `data/opening.bin`, serves `value`, `bestLine`,
      `moveValues` in budget slices (2M nodes), yielding between slices and dropping
      requests superseded by a newer generation id.
- [ ] Client: promise RPC, `Coach.create()`, graceful `available=false` on failure.
      Commit.

### Task 8: 3D scene

**Files:** `web/src/render/{scene,board-mesh,stones,marbles,table,anim,input,audio}.ts`

- [ ] Scene: renderer (ACES, sRGB, soft shadows), RoomEnvironment PMREM, key + fill
      lights, OrbitControls tuned like Pylos (damping 0.08, polar limit).
- [ ] Board: walnut lathe rim with groove + displaced grid play field with 37 dimples,
      procedural walnut texture; plaid tablecloth plane.
- [ ] Stones: 8 procedural canvas textures (fbm + veins), MeshPhysicalMaterial clearcoat.
- [ ] Marbles: one mesh per marble with stable identity; `setPosition`, `animateMove`
      (arc hop + captured marble rolls into groove slot), `animateUndo`, highlights
      (target rings, hint glow, heat-map labels), warning flash.
- [ ] Input: raycast pick, drag with ghost follow on board plane, tap-tap fallback,
      orbit disabled while dragging. Audio: synthesised clack.
- [ ] Verify in browser preview: board renders, marbles hop, captured marbles land in
      groove. Commit.

### Task 9: Solo play UI + coach levels

**Files:** `web/src/main.ts`, `web/src/ui/{hud,coach-panel,end-screen,setup}.ts`, `web/src/styles.css`

- [ ] Setup: tap a hole to remove first marble / random. HUD: marbles, moves, timer,
      undo/redo/restart. Coach level selector (Off/Warn/Hint/Show me), best-finish
      meter, Hint button, Show-me playback with step controls.
- [ ] End screen: result vs best possible from this start, time, "Review game".
- [ ] Verify each coach level in the browser. Commit.

### Task 10: Review + solutions explorer

**Files:** `web/src/ui/{review,explorer}.ts`

- [ ] Review: compute value before/after each move (worker), timeline chips (optimal /
      +k), select to view position, "Show best line", "Play from here".
- [ ] Explorer: heat map from `solutions.json`, select hole → animated perfect game with
      step controls. Verify in browser. Commit.

### Task 11: Race rooms

**Files:** `web/src/net/{room,race}.ts`, `web/src/net/race.test.ts`, `web/src/ui/{lobby,miniboard}.ts`

- [ ] Pure reducer `race.ts`: roster, host election (creator, else lowest peer id),
      config, start, per-peer move lists (validated via `Game.replay`), finish, ranking
      (fewest marbles, then time). Tests with `bun test`.
- [ ] `room.ts`: Trystero join by URL hash, actions hello/config/start/move/undo/finish.
- [ ] Lobby + mini-boards (SVG) + results table; coach disabled during race; review after.
- [ ] Verify with two browser tabs. Commit.

### Task 12: README, CI, deploy

- [ ] README: rules, solved table (best finish per start), how to run/build/solve.
- [ ] `.github/workflows/pages.yml`: checkout → rust + wasm target → build wasm → bun
      install → vite build (base `/amir-marble-solitaire/`) → deploy Pages.
- [ ] Create public repo `amirtarkian/amir-marble-solitaire`, push, enable Pages,
      confirm the live URL loads.
