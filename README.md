# Marble Solitaire

The 37-hole French marble solitaire board, in 3D, solved exactly. Play solo with a coach
that knows the best possible result from every position, race friends online, or watch
the perfect game from any starting hole.

**Play:** https://amirtarkian.github.io/amir-marble-solitaire/

## Rules

- The board has 37 holes in rows of 3-5-7-7-7-5-3. Every hole holds a marble except one
  starting hole, which you choose (any of the 37).
- A move: jump a marble over an adjacent marble (up, down, left or right) into the empty
  hole directly beyond it. The jumped marble comes off the board.
- The game ends when no jump is possible. Fewer marbles left is better; one is perfect.

## Solved

Every starting hole was solved by checking every reachable position (counted once per
symmetry of the board). "Best" is the fewest marbles anyone can finish with.

<!-- solved-table:start -->
<!-- solved-table:end -->

The centre start's count (374,349,517 positions, best finish 2) matches the figure
published by George Bell, which the solver checks on every run.

## Features

- **Coach levels:** Off, Warn (flags a jump that makes your best possible finish worse),
  Hint (live best-possible meter plus a best-move button), Show me (the coach plays its
  move or its whole line).
- **Game review:** every move graded optimal or "+k marbles", with "what should I have
  played?" and the best line from any point.
- **Solutions explorer:** a heat map of the best finish from every hole, and an animated
  perfect game for each.
- **Race rooms:** share a link; everyone plays the same start at the same time with live
  mini-boards. Fewest marbles wins, the faster finish breaks ties. Peer-to-peer over
  WebRTC (Trystero), no server.

## How it works

```
engine/   Rust: bitboard rules, symmetry, position class, exact search
solver/   Rust: exhaustive solve of all 8 distinct starts
wasm/     the engine compiled to WebAssembly for the browser coach
web/      Bun + Vite + TypeScript + Three.js app
```

- **Positions are 64-bit bitboards.** Jumps are generated with four shift-and-mask
  operations, one per direction.
- **Symmetry:** the board has 8 symmetries; every position is stored in its smallest
  form, which cuts the state space 8×.
- **Position class:** colouring the board along both diagonals gives a 4-bit invariant
  that no jump changes. It proves, for example, that the centre start can never finish
  with one marble, without any search.
- **Exhaustive solve:** for each start the solver builds every reachable position level
  by level (36 marbles, 35, …), streaming each level to disk as a sorted file, then
  scores every position from the bottom up: a position's value is the best of its
  children's. The largest starts reach about 1.9 billion positions; peak memory stays
  around 3–4 GB.
- **Coach in the browser:** the early game is the expensive part to prove, so the solver
  ships an *opening table* of exact values for early positions that do worse than the
  class bound predicts. Everything later is solved live by a depth-first search with a
  transposition table, in a Web Worker running the same Rust engine as WebAssembly.

## Run it locally

Needs Rust (with `rustup target add wasm32-unknown-unknown`) and Bun.

```bash
./scripts/build-wasm.sh          # engine.wasm → web/public
cd web && bun install && bun run dev
```

Tests:

```bash
cargo test --release -p engine
cd web && bun test src
```

Re-run the solver (about 45 minutes for all starts on an M-series MacBook; needs ~25 GB
of free disk while it runs):

```bash
cargo run --release -p solver -- solve            # all 8 starts → data-cache/
cargo run --release -p solver -- bench            # live-search cost per level
cargo run --release -p solver -- build-data 10    # web/public/data/
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`.
