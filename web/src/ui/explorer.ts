// Solutions explorer: the best finish from every starting hole, and its perfect game.

import type { App, Screen } from "../app";
import { type Cell, HOLES, label } from "../board/geometry";
import { type HoleSolution, easyMoves, heatColor, holeSolution, orbitStats } from "../data/solutions";
import { startBoard } from "../game/state";
import { clear, h, plural } from "./dom";
import { LinePlayer } from "./playback";

const fullBoard = () => Uint8Array.from({ length: 49 }, (_, i) => (HOLES.includes(i) ? 1 : 0));

export class ExplorerScreen implements Screen {
  private player: LinePlayer | null = null;

  constructor(private app: App) {
    this.overview();
  }

  unmount() {
    this.player?.stop();
    this.app.view.setHeat(null);
  }

  private overview() {
    const { view, panel, solutions } = this.app;
    this.player?.stop();
    this.player = null;
    view.setBoard(fullBoard());
    view.setMode("view");
    view.events = { onHoleClick: (cell) => this.open(cell) };
    clear(panel);
    if (!solutions) {
      panel.append(h("section.card", {}, h("h2", {}, "Solutions"), h("p.notice", {}, "Couldn't load the solver's results.")));
      return;
    }
    view.setHeat(solutions.holes.map((s) => ({ cell: s.cell, color: heatColor(s.best), text: String(s.best) })));
    const ones = solutions.holes.filter((s) => s.best === 1).length;
    const rows = [...solutions.orbits]
      .sort((a, b) => a.best - b.best || a.rep.localeCompare(b.rep))
      .map((o) => {
        const holes = solutions.holes.filter((s) => s.orbit === o.rep);
        return h("tr",
          { onclick: () => this.open(holes[0].cell) },
          h("td", {}, h("span.dot", { style: `background:${heatColor(o.best)}` }), " ", holes.map((s) => s.label).join(" ")),
          h("td.num", {}, String(o.best)),
          h("td.num", {}, o.reachable >= 1e9 ? `${(o.reachable / 1e9).toFixed(2)}B` : `${Math.round(o.reachable / 1e6)}M`),
        );
      });
    panel.append(h("section.card",
      {},
      h("h2", {}, "Solved: every starting hole"),
      h("p", {}, `The number on each hole is the fewest marbles you can finish with if that hole starts empty, proven by checking every reachable position. ${ones} of the 37 holes can be solved down to a single marble. Tap a hole to watch its perfect game.`),
      h("table.solutions",
        {},
        h("thead", {}, h("tr", {}, h("th", {}, "Starting hole"), h("th.num", {}, "Best"), h("th.num", {}, "Positions"))),
        h("tbody", {}, ...rows),
      ),
      h("p.muted", {}, "Positions are counted once per symmetry (rotations and reflections of the board)."),
    ));
  }

  private open(cell: Cell) {
    const { view, panel, solutions } = this.app;
    const sol: HoleSolution | undefined = solutions ? holeSolution(solutions, cell) : undefined;
    if (!sol) return;
    this.player?.stop();
    view.setHeat(null);
    view.setBoard(startBoard(cell));
    const line = easyMoves(sol);
    const stats = orbitStats(solutions!, sol);
    const player = new LinePlayer(view, line, { caption: (k) => `${36 - k} marbles · move ${k}/${line.length}` });
    this.player = player;
    clear(panel);
    panel.append(h("section.card",
      {},
      h("div.card-head", {}, h("h2", {}, `Perfect game from ${label(cell)}`), h("button.ghost.small", { onclick: () => this.overview() }, "All holes")),
      h("p", {}, `Best possible: ${plural(sol.best, "marble")}. ${stats.reachable.toLocaleString()} distinct positions can arise from this start. Of the many perfect games, this is the easiest to replicate: at every step it keeps the most room for error.`),
      h("p.muted", {}, h("a.principle-link", { href: "#/learn" }, "Learn it in chunks, with its key moments, on the Learn tab →")),
      player.el,
      h("p.muted", {}, "Drag empty space to orbit the board. Arrow keys step, space plays and pauses."),
    ));
  }
}
