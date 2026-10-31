// Opening explorer: every legal move from the current position, drawn on the board as a
// green arrow (keeps your best finish) or a thin red one (throws marbles away). Play any
// of them, on the board or from the list, step back, or follow the solver.

import type { App } from "../app";
import { type Cell, label } from "../board/geometry";
import { Cancelled, type MoveGrades } from "../coach/client";
import { Game, type Move } from "../game/state";
import { clear, h, plural } from "./dom";

const GOOD = "#3dff9a", BAD = "#ff5a3c";

export class OpeningExplorer {
  readonly el: HTMLElement;
  private path: Move[];
  private busy = false;
  private stopped = false;
  private gen = 0;
  private status = h("div.explorer-status");
  private list = h("ul.explorer-moves");
  private backBtn: HTMLButtonElement;

  /** The board must already show the start position followed by `path`. */
  constructor(private app: App, private start: Cell, path: Move[] = []) {
    this.path = [...path];
    this.backBtn = h("button", { onclick: () => void this.back() }, "‹ Back");
    this.el = h("div.explorer",
      {},
      h("div.player-controls.explorer-controls",
        {},
        this.backBtn,
        h("button", { onclick: () => void this.reset() }, "Start over"),
        h("button.primary", { onclick: () => void this.solverMove() }, "Solver's move ›"),
      ),
      this.status,
      this.list,
    );
    void this.refresh();
  }

  get moves(): Move[] {
    return [...this.path];
  }

  stop() {
    this.stopped = true;
    this.gen++;
    const { view } = this.app;
    view.setArrows([]);
    view.setHint(null);
    view.setMoves([]);
    view.events = {};
  }

  private position(): Game {
    return Game.replay(this.start, this.path);
  }

  private async play(m: Move) {
    if (this.busy || this.stopped) return;
    this.busy = true;
    this.app.view.setArrows([]);
    this.app.view.setMoves([]);
    this.path.push(m);
    await this.app.view.playMove(m, 1.3);
    this.busy = false;
    await this.refresh();
  }

  private async back() {
    const m = this.path[this.path.length - 1];
    if (!m || this.busy || this.stopped) return;
    this.busy = true;
    this.app.view.setArrows([]);
    this.path.pop();
    await this.app.view.undoMove(m, 1.6);
    this.busy = false;
    await this.refresh();
  }

  private async reset() {
    if (this.busy || this.stopped) return;
    this.path = [];
    this.app.view.setBoard(this.position().board);
    await this.refresh();
  }

  private async solverMove() {
    const coach = this.app.coach;
    if (!coach || this.busy) return;
    try {
      const line = await coach.bestLine(this.position().bits(), { priority: 10, group: "explorer" });
      if (line.length) await this.play(line[0]);
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    }
  }

  private async refresh() {
    if (this.stopped) return;
    const gen = ++this.gen;
    const game = this.position();
    const { view, coach } = this.app;
    this.backBtn.disabled = this.path.length === 0;
    view.setHint(null);
    view.setMode("play");
    view.setMoves(game.legalMoves());
    view.events = { onMove: (m) => void this.play(m) };
    clear(this.list);
    this.status.textContent = `Move ${this.path.length + 1} · ${plural(game.marbles, "marble")} on the board · working out each move…`;
    if (game.isOver) {
      this.status.textContent = `No jumps left: finished with ${plural(game.marbles, "marble")}.`;
      return;
    }
    if (!coach) {
      this.status.textContent = "The coach engine isn't available.";
      return;
    }
    let grades: MoveGrades;
    try {
      grades = await coach.grades(game.bits(), { priority: 10, group: "explorer" });
    } catch (e) {
      if (e instanceof Cancelled) return;
      throw e;
    }
    if (gen !== this.gen || this.stopped) return;
    const good = grades.moves.filter((x) => x.good);
    view.setArrows(grades.moves.map((x) => ({ move: x.move, color: x.good ? GOOD : BAD, strong: x.good })));
    const verdict = good.length === grades.moves.length
      ? "Every move keeps it: a free choice."
      : good.length === 1
        ? "Only one move keeps it: a key moment."
        : good.length <= 2
          ? "Few moves keep it: slow down here."
          : "";
    this.status.textContent = `Move ${this.path.length + 1} · best possible ${plural(grades.value, "marble")}. ${good.length} of ${grades.moves.length} moves keep it. ${verdict}`;
    const sorted = [...grades.moves].sort((a, b) => Number(b.good) - Number(a.good));
    for (const x of sorted) {
      this.list.append(h("li", {},
        h("button", { class: x.good ? "good" : "bad", onclick: () => void this.play(x.move) },
          h("span.mv", {}, `${label(x.move.from)} → ${label(x.move.to)}`),
          h("span.verdict", {}, x.good ? `✓ keeps ${grades.value}` : "✗ loses marbles"))));
    }
  }

  /** Jump straight to a position on the solver's line (used by "key moments"). */
  async goTo(path: Move[], highlight?: Move) {
    this.path = [...path];
    this.app.view.setBoard(this.position().board);
    await this.refresh();
    if (highlight && !this.stopped) {
      const li = [...this.list.querySelectorAll("button")].find((b) => b.querySelector(".mv")?.textContent === `${label(highlight.from)} → ${label(highlight.to)}`);
      li?.classList.add("solver");
    }
  }
}
