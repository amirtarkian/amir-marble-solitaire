// Learn: the principles behind good play, each checked against the solver, plus the
// solver's openings and closings for every start.

import type { App, Screen } from "../app";
import { finishingHoles, UNJUMPABLE } from "../board/facts";
import { type Cell, HOLES, isHole, label, parseLabel, rc } from "../board/geometry";
import { Cancelled } from "../coach/client";
import { type Solutions, heatColor, holeSolution, lineMoves } from "../data/solutions";
import { Game, type Move, makeMove, startBoard } from "../game/state";
import { clear, h, plural } from "./dom";
import { LinePlayer } from "./playback";

const fullBoard = () => Uint8Array.from({ length: 49 }, (_, i) => (HOLES.includes(i) ? 1 : 0));
const CENTRE_BLOCK = HOLES.filter((x) => {
  const [r, c] = rc(x);
  return Math.abs(r - 3) <= 1 && Math.abs(c - 3) <= 1;
});

interface LineStats {
  cornerEmptied: number;
  centreEmptied: number;
  isolatedShare: number;
}

/** Facts mined from the solver's 37 perfect games. */
function lineStats(sol: Solutions): LineStats {
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const corner: number[] = [], centre: number[] = [];
  let isolated = 0, positions = 0;
  for (const hole of sol.holes) {
    const g = new Game(hole.cell);
    const emptied = new Map<Cell, number>([[hole.cell, 0]]);
    hole.line.forEach(([f, t], k) => {
      const m = makeMove(f, t);
      g.play(m);
      emptied.set(m.from, k + 1);
      emptied.set(m.over, k + 1);
      emptied.delete(m.to);
      if (k < hole.line.length - 3) {
        positions++;
        if (HOLES.some((x) => g.board[x] && !neighbours(x).some((n) => g.board[n]))) isolated++;
      }
    });
    for (const [cell, k] of emptied) {
      if (UNJUMPABLE.includes(cell)) corner.push(k);
      else if (CENTRE_BLOCK.includes(cell)) centre.push(k);
    }
  }
  return { cornerEmptied: mean(corner), centreEmptied: mean(centre), isolatedShare: isolated / Math.max(1, positions) };
}

function neighbours(cell: Cell): Cell[] {
  const [r, c] = rc(cell);
  return [[0, 1], [0, -1], [1, 0], [-1, 0]]
    .map(([dr, dc]) => [r + dr, c + dc])
    .filter(([r2, c2]) => r2 >= 0 && r2 < 7 && c2 >= 0 && c2 < 7 && isHole(r2 * 7 + c2))
    .map(([r2, c2]) => r2 * 7 + c2);
}

/** Share of positions after `moves` moves that can still reach the start's best finish. */
function onTrack(sol: Solutions, rep: string, moves: number): number | null {
  const o = sol.orbits.find((x) => x.rep === rep);
  const l = o?.levels.find((x) => x.marbles === 36 - moves);
  return l ? l.on_track / l.positions : null;
}

const pct = (x: number | null) => (x === null ? "?" : `${Math.round(x * 100)}%`);

export class LearnScreen implements Screen {
  private player: LinePlayer | null = null;
  private slots: HTMLElement[] = [];
  private finishNote = h("p.demo-note");
  private openingBody = h("div.opening-body");

  constructor(private app: App) {
    this.render();
    this.showBestPerHole();
  }

  unmount() {
    this.player?.stop();
    this.app.view.setHeat(null);
    this.app.view.events = {};
  }

  // ── Board demonstrations ─────────────────────────────────────────────

  private reset(board: Uint8Array) {
    this.player?.stop();
    this.player = null;
    for (const s of this.slots) clear(s);
    const { view } = this.app;
    view.setHint(null);
    view.setHeat(null);
    view.setMode("view");
    view.setBoard(board);
    view.events = {};
  }

  private play(slot: HTMLElement, line: Move[], caption?: (k: number) => string) {
    this.player = new LinePlayer(this.app.view, line, caption ? { caption } : {});
    slot.append(this.player.el);
  }

  private showBestPerHole() {
    const sol = this.app.solutions;
    this.reset(fullBoard());
    if (sol) this.app.view.setHeat(sol.holes.map((s) => ({ cell: s.cell, color: heatColor(s.best), text: String(s.best) })));
    this.app.view.events = { onHoleClick: (cell) => this.showFinishes(cell) };
  }

  private showFinishes(cell: Cell) {
    this.reset(startBoard(cell));
    const ends = finishingHoles(cell);
    this.app.view.setHeat([
      { cell, color: "#e8e1d6", text: "S" },
      ...ends.map((e) => ({ cell: e, color: heatColor(1), text: "E" })),
    ]);
    this.app.view.events = { onHoleClick: (c) => this.showFinishes(c) };
    this.finishNote.textContent = ends.length
      ? `Starting at ${label(cell)} (S), your last marble can only end on ${ends.map(label).join(", ")} (E).`
      : `${label(cell)} is a two-marble start: no single-marble finish exists from it, whatever you do.`;
  }

  private showCorners() {
    this.reset(fullBoard());
    this.app.view.setHeat(UNJUMPABLE.map((cell) => ({ cell, color: "#e5603c", text: "!" })));
  }

  private showPurge(slot: HTMLElement) {
    const b = new Uint8Array(49);
    for (const s of ["c5", "c4", "d4", "e4"]) b[parseLabel(s)!] = 1;
    this.reset(b);
    const at = (s: string) => parseLabel(s)!;
    const line = [makeMove(at("c5"), at("c3")), makeMove(at("e4"), at("c4")), makeMove(at("c3"), at("c5"))];
    const steps = ["Catalyst c5 waits beside the line c4 d4 e4; c3 is empty.", "1. The catalyst jumps over c4.", "2. e4 jumps over d4 into c4.", "3. The catalyst jumps back: line gone."];
    this.play(slot, line, (k) => steps[k]);
  }

  private showOpening(rep: Cell, part: "opening" | "closing", slot: HTMLElement) {
    const sol = this.app.solutions;
    const hole = sol && holeSolution(sol, rep);
    if (!hole) return;
    const line = lineMoves(hole);
    const cut = part === "opening" ? 0 : Math.max(0, line.length - 8);
    this.reset(Game.replay(rep, line.slice(0, cut)).board);
    const moves = part === "opening" ? line.slice(0, 8) : line.slice(cut);
    this.play(slot, moves, (k) => `${36 - cut - k} marbles · ${part} move ${k}/${moves.length}`);
  }

  // ── Panel ────────────────────────────────────────────────────────────

  private principle(n: number, title: string, body: (Node | string)[], demo?: { label: string; run: (slot: HTMLElement) => void }) {
    const slot = h("div.demo-slot");
    this.slots.push(slot);
    return h("section.card.principle",
      {},
      h("div.card-head", {}, h("h2", {}, h("span.num", {}, String(n)), title)),
      ...body.map((b) => (typeof b === "string" ? h("p", {}, b) : b)),
      demo ? h("div.row", {}, h("button", { onclick: () => demo.run(slot) }, demo.label)) : null,
      slot,
    );
  }

  private render() {
    const { panel, solutions: sol } = this.app;
    clear(panel);
    const stats = sol ? lineStats(sol) : null;
    const ones = sol ? sol.holes.filter((x) => x.best === 1).length : 16;

    panel.append(
      h("section.card",
        {},
        h("h2", {}, "How to get good"),
        h("p", {}, "You don't need to memorise lines. These ideas are enough to play well and to teach the game, and each one is checked against the solver's perfect games."),
        h("ul.tips",
          {},
          h("li", {}, "Want a one-marble finish? Start on a gold hole."),
          h("li", {}, "Before move 1, know the four holes your last marble can end on."),
          h("li", {}, "Get corner marbles out before the endgame. Nothing can jump over them."),
          h("li", {}, "Clear blocks with a catalyst marble instead of grabbing random jumps."),
          h("li", {}, "Play the opening quickly. Slow down from about move 8 to move 20."),
          h("li", {}, "With about 8 marbles left, plan the finish backwards from your target hole."),
          h("li", {}, "Practise with the coach on Warn: it flags exactly the jumps that cost you."),
        ),
      ),
      this.principle(1, "Your start sets your ceiling", [
        `Only ${ones} of the 37 holes can finish with a single marble: the four next to the centre in a straight line (d5, c4, e4, d3), the four two steps out (d6, b4, f4, d2), and the eight outer corners. From the other 21, including the centre, the best anyone can do is two.`,
        h("details", {},
          h("summary", {}, "Why? (the parity rule)"),
          h("p", {}, "Colour the holes in three colours along each diagonal. Every jump touches three holes in a row, one of each colour, so it flips whether each colour count is odd or even. Some odd/even combinations can therefore never change, and that fixed \"class\" decides which single-marble finishes are possible. No amount of skill gets around it."),
        ),
      ], { label: "Show every hole's best", run: () => this.showBestPerHole() }),
      this.principle(2, "Know where you're heading", [
        "From a one-marble start there are exactly four holes your last marble can end on, and the hole you started from is never one of them. Pick the one that suits the endgame and steer toward it.",
        this.finishNote,
      ], { label: "Show finishing holes for e7", run: () => this.showFinishes(parseLabel("e7")!) }),
      this.principle(3, "Corners can't be captured", [
        "The 8 outer corners and the 4 inner shoulders (b6, f6, b2, f2) have no neighbour on both sides in any line, so nothing can ever jump over them. A marble there only leaves by jumping out, which needs a marble beside it and an empty hole beyond.",
        stats
          ? `In the solver's perfect games these 12 holes are emptied for good around move ${Math.round(stats.cornerEmptied)}, about ${Math.round(stats.centreEmptied - stats.cornerEmptied)} moves before the centre. Use corner marbles as jumpers while they still have company.`
          : "",
      ], { label: "Highlight the 12 corner holes", run: () => this.showCorners() }),
      this.principle(4, "Clear blocks in packages", [
        "Good games are chains of small packages. The basic one removes three marbles in a row using a catalyst beside one end and an empty hole on the other side of that end: the catalyst jumps over the end marble, the far marble jumps over the middle one into the end's hole, and the catalyst jumps back. Three marbles gone, catalyst home, hole free for the next package.",
      ], { label: "Watch the three-marble purge", run: (slot) => this.showPurge(slot) }),
      this.principle(5, "Lonely marbles are fine, if you can reach them", [
        stats
          ? `It's tempting never to leave a marble alone, but perfect play does it constantly: ${pct(stats.isolatedShare)} of positions in the solver's perfect games have at least one isolated marble. What matters is that some marble can still land beside it later.`
          : "Perfect play leaves marbles isolated all the time. What matters is that some marble can still land beside it later.",
        "Corners are the exception: a lonely corner marble has only two holes a rescuer can land on.",
      ]),
      this.principle(6, "The middle game decides it", [
        sol
          ? `The opening is forgiving. From d5, ${pct(onTrack(sol, "d5", 5))} of the positions you can reach after 5 moves can still finish with one marble. After 10 moves it's ${pct(onTrack(sol, "d5", 10))}, after 15 it's ${pct(onTrack(sol, "d5", 15))}. Most games are won or lost between moves 8 and 20, so that's where to slow down.`
          : "The opening is forgiving; most games are won or lost between moves 8 and 20.",
      ]),
      this.principle(7, "Plan the finish backwards", [
        "With about 8 marbles left, stop and work back from your target hole: which jump lands the last marble there, which jump sets that up, and so on. The closings below show the solver funnelling its last marbles in.",
      ]),
      this.openingsCard(),
    );
  }

  private openingsCard(): HTMLElement {
    const sol = this.app.solutions;
    const chips = h("div.chips");
    const card = h("section.card",
      {},
      h("h2", {}, "Openings and closings"),
      h("p.muted", {}, "One family per starting hole and its mirror images. Pick one to see the optimal first moves and to step through the solver's opening and closing."),
      chips,
      this.openingBody,
    );
    if (!sol) {
      this.openingBody.append(h("p.notice", {}, "Couldn't load the solver's results."));
      return card;
    }
    const reps = [...sol.orbits].sort((a, b) => a.best - b.best || a.rep.localeCompare(b.rep));
    for (const o of reps) {
      const cell = parseLabel(o.rep)!;
      chips.append(h("button.chip-btn", {
        onclick: (e: Event) => {
          [...chips.children].forEach((c) => c.classList.toggle("on", c === e.currentTarget));
          void this.selectOpening(cell);
        },
      }, h("span.dot", { style: `background:${heatColor(o.best)}` }), ` ${o.rep} · ${o.best}`));
    }
    return card;
  }

  private async selectOpening(cell: Cell) {
    const sol = this.app.solutions!;
    const hole = holeSolution(sol, cell)!;
    const family = sol.holes.filter((x) => x.orbit === hole.orbit).map((x) => x.label);
    this.reset(startBoard(cell));
    const body = this.openingBody;
    clear(body);
    const firstMoves = h("p", {}, "Working out the optimal first moves…");
    const slot = h("div.demo-slot");
    this.slots.push(slot);
    body.append(
      h("p", {}, h("strong", {}, `${label(cell)}`), ` (also ${family.filter((l) => l !== label(cell)).join(", ")}): best possible ${plural(hole.best, "marble")}.`),
      firstMoves,
      h("div.row",
        {},
        h("button", { onclick: () => this.showOpening(cell, "opening", slot) }, "Step through the opening"),
        h("button", { onclick: () => this.showOpening(cell, "closing", slot) }, "Step through the closing"),
        h("button.primary", { onclick: () => (location.hash = `#/play/${label(cell)}`) }, `Play ${label(cell)}`),
      ),
      slot,
    );
    const coach = this.app.coach;
    if (!coach) {
      firstMoves.textContent = "";
      return;
    }
    try {
      const mv = await coach.moveValues(new Game(cell).bits(), { priority: 10, group: "learn" });
      const good = mv.filter((x) => x.value === hole.best).map((x) => `${label(x.move.from)}→${label(x.move.to)}`);
      firstMoves.textContent = good.length === mv.length
        ? `All ${mv.length} first moves keep the best finish: ${good.join(", ")}.`
        : `Optimal first moves: ${good.join(", ")} (${good.length} of ${mv.length}).`;
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    }
  }
}
