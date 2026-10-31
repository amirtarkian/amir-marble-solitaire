# Marble Solitaire — Design

Date: 2026-10-31 · Status: approved

## Goal

A web app for the 37-hole French marble solitaire board (the walnut board with stone
marbles in Amir's photo): play it in 3D, race friends online, and learn from an exact
coach that knows the optimal result from every position.

## Rules

- Board: 37 holes in rows of 3-5-7-7-7-5-3 (7×7 grid minus the three-hole corners).
- Setup: every hole holds a marble except one starting hole, chosen freely (37 choices,
  8 up to the board's 8-fold symmetry).
- Move: a marble jumps orthogonally over an adjacent marble into an empty hole directly
  beyond it; the jumped marble is removed. Diagonal jumps are not allowed.
- The game ends when no jump is possible. Score = marbles left; fewer is better.
- Known fact used as a check: from the centre start the best finish is 2 marbles, and
  374,349,517 symmetry-distinct positions are reachable (G. Bell).

## Features

1. **Solo play** — tap any hole at setup to remove its marble (or pick random). Move by
   drag-and-drop or tap-marble-then-tap-hole. Unlimited undo/redo, timer, move count.
2. **Coach levels** (replaces "AI difficulty"):
   - *Off* — no help during play.
   - *Warn* — after a move that worsens your best possible finish, the board flashes and
     the HUD says by how much; undo is one tap away.
   - *Hint* — live "best possible finish from here" meter plus a Hint button that
     highlights an optimal move.
   - *Show me* — the coach plays the optimal continuation from the current position,
     animated, step-controllable.
3. **Game review** — after every game: a timeline of your moves, each tagged optimal or
   "+k marbles". Selecting a move shows that position; "Show best line" animates what
   optimal play would have done from there; "Play from here" branches a new game.
4. **Solutions explorer** — the board as a heat map of the best finish from each of the
   37 starting holes; selecting a hole plays its perfect game.
5. **Race rooms** — host creates a room and shares the link; everyone plays the same
   starting hole simultaneously on their own board, with live mini-boards of the others.
   Fewest marbles wins; ties go to the faster finish. Coach is off during the race, and
   everyone gets the review afterwards.
6. **3D presentation** — round walnut board with an outer groove, real dimpled holes,
   procedurally textured stone marbles (jade, rose quartz, carnelian, serpentine, blue
   calcite, honey jasper…), soft shadows and reflections, a plaid tablecloth. Jumps arc;
   captured marbles roll into the groove. Synthesised stone-on-wood click sounds. Orbit
   and zoom camera (tuning borrowed from Pylos-Engine). Works on phones.

## Architecture

```
amir-marble-solitaire/
  engine/   Rust lib  — board, moves, symmetry, position class, exact search
  solver/   Rust bin  — offline exhaustive solve → web/public/data/*
  wasm/     Rust cdylib — raw C-ABI exports of engine for the browser (no bindgen)
  web/      Bun + Vite + TypeScript + Three.js app
```

### Engine (Rust, `engine/`)

- Position = `u64` bitboard over a 7×7 grid, bit `r*7+c`; 37 valid bits.
- Move generation by shifts (±1 horizontally, ±7 vertically) masked by precomputed
  "valid from" masks per direction.
- Symmetry: the 8 dihedral transforms via per-row lookup tables; `canon(p)` = minimum
  of the 8 images.
- Position class: the 16-class invariant (two diagonal 3-colourings, parity). Gives a
  lower bound: if no single hole shares the position's class, at least 2 marbles remain.
- Exact search: `can_reach(p, t)` — DFS asking "can ≤ t marbles remain?", with a
  transposition table keyed by `canon(p)` that records the best proven lower bound and
  any known exact value. `value(p)` iterates `t` upward from the lower bound.
  `best_line(p)` returns an optimal move sequence. An optional node budget lets the
  browser bail out and report "not proven yet" instead of freezing.

### Offline solver (`solver/`)

For each of the 8 distinct starts: forward pass by marble count (canonical positions,
parallel sort + dedup with rayon), then a backward pass computing every position's exact
value (min over children; leaves score their marble count). Outputs:

- `solutions.json` — per hole (all 37, in real orientation): best finish, one optimal
  move list, reachable-position counts per level.
- `opening.bin` — exact values for every reachable position in the first N moves of every
  start (sorted canonical keys, delta + varint encoded, 4-bit values). N is chosen by
  measurement so the file stays a few MB; these are the positions where live proofs are
  too slow for a browser.

The centre start's reachable count must equal 374,349,517 and its value must be 2.

### Browser engine (`wasm/` + web worker)

`engine.wasm` exports `alloc`, `load_opening`, `legal_moves`, `value`, `best_line`.
It runs in a Web Worker behind a small promise-based RPC (`coach/client.ts`). Lookups
hit the opening table first, then the live search. All values shown to the player are
exact; if a budget runs out, the UI shows a spinner rather than a guess.

### Web app (`web/`)

- `board/geometry.ts` — the 37 holes, indices, world coordinates.
- `game/state.ts` — rules mirror in TS, history with undo/redo, serialisable move list.
- `render/` — scene, board mesh (lathe rim + displaced dimpled play field), stone
  textures, marbles, animation queue, picking/drag input, audio.
- `ui/` — HUD, coach panel, end screen, review timeline, solutions explorer, room lobby,
  mini-boards (SVG).
- `net/room.ts` — Trystero (WebRTC, public signalling) room wrapper.

### Race protocol

Room id lives in the URL hash. Creator is host; if the host leaves, the peer with the
lowest id takes over. Messages: `hello{name}`, `config{startHole}`, `start{startHole,
at}`, `move{from,to}`, `undo`, `finish{marbles,ms}`. Each client replays peers' move lists
to draw their mini-boards and validates them with the same rules.

### Hosting

Static site on GitHub Pages (public repo `amirtarkian/amir-marble-solitaire`).
A GitHub Actions workflow builds the wasm and the Vite app and deploys. Generated solver
data is committed (the solve takes minutes to hours; the wasm build is seconds).

## Error handling

- Coach worker fails to load → coach controls disabled with a short notice; play
  still works (rules live in TS).
- Room signalling fails → lobby shows "couldn't connect, retry" with the room link still
  copyable; solo play unaffected.
- Peer sends an illegal move → that peer's mini-board marks "desynced"; it does not affect
  anyone else's game.

## Testing

- Rust: move counts, symmetry group properties, canonical invariance, class invariance
  under moves, live search equals exhaustive values on sampled positions, centre-start
  counts and value.
- TS (`bun test`): rules, undo/redo, geometry, race-protocol reducer.
- Browser: play a game, coach at each level, review, explorer, two-tab race room.

## Out of scope

Diagonal-jump variant, other board shapes, accounts/leaderboards, an opponent AI.
