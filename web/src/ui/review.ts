// Post-game review: every move tagged optimal or "+k marbles", with the coach's best
// line available from any point in the game.

import type { App } from "../app";
import { type Cell, label } from "../board/geometry";
import { Cancelled } from "../coach/client";
import { Game, type Move } from "../game/state";
import { clear, h, plural } from "./dom";
import { LinePlayer } from "./playback";

export interface ReviewActions {
  onPlayFrom: (moves: Move[]) => void;
  onClose: () => void;
}

export class ReviewScreen {
  /** values[i] = best possible finish after the first i moves. */
  private values: (number | null)[];
  private selected: number;
  private chips: HTMLButtonElement[] = [];
  private detail = h("div.detail");
  private summary = h("p.summary");
  private player: LinePlayer | null = null;
  private closed = false;

  constructor(private app: App, private start: Cell, private moves: Move[], private actions: ReviewActions) {
    this.values = new Array(moves.length + 1).fill(null);
    this.selected = moves.length;
    this.render();
    void this.analyse();
  }

  unmount() {
    this.closed = true;
    this.player?.stop();
    this.app.coach?.cancel("review");
    this.app.view.setHint(null);
  }

  private positionBits(i: number): bigint {
    return Game.replay(this.start, this.moves.slice(0, i)).bits();
  }

  private async analyse() {
    const coach = this.app.coach;
    if (!coach) {
      this.summary.textContent = "The coach engine isn't available, so moves can't be graded.";
      return;
    }
    try {
      for (let i = 0; i <= this.moves.length && !this.closed; i++) {
        this.values[i] = await coach.value(this.positionBits(i), { group: "review" });
        this.paintChip(i);
        if (i === this.selected || i === this.selected - 1) this.renderDetail();
      }
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
      return;
    }
    const costly = this.moves.filter((_, i) => this.cost(i + 1)! > 0).length;
    const start = this.values[0]!, end = this.values[this.moves.length]!;
    this.summary.textContent = costly === 0
      ? `Every move kept your best possible finish at ${plural(start, "marble")}. Flawless.`
      : `${this.moves.length - costly} of ${this.moves.length} moves were optimal. ${plural(costly, "move")} cost you ${plural(end - start, "marble")} in total.`;
  }

  /** Marbles lost by move i (1-based), once both sides are known. */
  private cost(i: number): number | null {
    const a = this.values[i - 1], b = this.values[i];
    return a === null || b === null ? null : b - a;
  }

  private paintChip(i: number) {
    const chip = this.chips[i - 1];
    if (!chip) return;
    const c = this.cost(i);
    chip.classList.remove("pending");
    if (c === null) chip.classList.add("pending");
    else if (c === 0) chip.classList.add("ok");
    else chip.classList.add(c === 1 ? "minor" : "major");
    if (c) chip.dataset.cost = `+${c}`;
  }

  private render() {
    const { panel } = this.app;
    const timeline = h("div.timeline");
    this.chips = this.moves.map((m, idx) => {
      const chip = h("button.chip.pending", { title: `${label(m.from)} → ${label(m.to)}`, onclick: () => this.select(idx + 1) }, String(idx + 1));
      timeline.append(chip);
      return chip;
    });
    clear(panel);
    panel.append(h("section.card",
      {},
      h("div.card-head", {}, h("h2", {}, "Game review"), h("button.ghost.small", { onclick: () => this.actions.onClose() }, "Close")),
      this.summary,
      h("div.legend", {}, h("span.chip.ok", {}, ""), " optimal ", h("span.chip.minor", {}, ""), " cost 1 ", h("span.chip.major", {}, ""), " cost 2+"),
      timeline,
      this.detail,
    ));
    this.summary.textContent = "Grading your moves…";
    this.select(this.moves.length);
  }

  private select(i: number) {
    this.player?.stop();
    this.player = null;
    this.selected = i;
    this.chips.forEach((c, k) => c.classList.toggle("sel", k + 1 === i));
    const game = Game.replay(this.start, this.moves.slice(0, i));
    this.app.view.setMode("view");
    this.app.view.setBoard(game.board);
    this.app.view.setHint(null);
    this.renderDetail();
  }

  private renderDetail() {
    const i = this.selected, d = this.detail;
    clear(d);
    if (i === 0) {
      d.append(h("p", {}, `Starting position: ${label(this.start)} empty.`));
    } else {
      const m = this.moves[i - 1], c = this.cost(i);
      d.append(h("p", {},
        h("strong", {}, `Move ${i}: ${label(m.from)} → ${label(m.to)}. `),
        c === null ? "Grading…" : c === 0 ? "Optimal." : `Cost ${plural(c, "marble")}: best possible went from ${this.values[i - 1]} to ${this.values[i]}.`,
      ));
    }
    const v = this.values[i];
    if (v !== null) d.append(h("p.muted", {}, `From this position the best possible finish is ${plural(v, "marble")}.`));
    d.append(h("div.row",
      {},
      i > 0 ? h("button", { onclick: () => void this.bestInstead(i) }, "What should I have played?") : null,
      h("button", { onclick: () => void this.showBest(i) }, "Show best line from here"),
      h("button.primary", { onclick: () => this.actions.onPlayFrom(this.moves.slice(0, i)) }, "Play from here"),
    ));
  }

  /** Show the position before move i with the best move highlighted. */
  private async bestInstead(i: number) {
    const coach = this.app.coach;
    if (!coach) return;
    const before = Game.replay(this.start, this.moves.slice(0, i - 1));
    this.app.view.setBoard(before.board);
    this.chips.forEach((c, k) => c.classList.toggle("sel", k + 1 === i));
    try {
      const line = await coach.bestLine(before.bits(), { priority: 10, group: "review" });
      if (!line.length || this.selected !== i) return;
      this.app.view.setHint(line[0]);
      const m = this.moves[i - 1];
      const same = line[0].from === m.from && line[0].to === m.to;
      clear(this.detail);
      this.detail.append(
        h("p", {}, same ? "You found it: that was the coach's choice too." : `Before move ${i}, the coach would play ${label(line[0].from)} → ${label(line[0].to)} (glowing green). You played ${label(m.from)} → ${label(m.to)}.`),
        h("div.row",
          {},
          h("button", { onclick: () => this.select(i) }, "Back"),
          h("button", { onclick: () => void this.showBest(i - 1) }, "Watch the best line"),
          h("button.primary", { onclick: () => this.actions.onPlayFrom(this.moves.slice(0, i - 1)) }, "Replay from here"),
        ),
      );
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    }
  }

  private async showBest(i: number) {
    const coach = this.app.coach;
    if (!coach) return;
    const pos = Game.replay(this.start, this.moves.slice(0, i));
    let line: Move[];
    try {
      line = await coach.bestLine(pos.bits(), { priority: 10, group: "review" });
    } catch (e) {
      if (e instanceof Cancelled) return;
      throw e;
    }
    this.app.view.setHint(null);
    this.app.view.setBoard(pos.board);
    const player = new LinePlayer(this.app.view, line, {
      caption: (k) => `${pos.marbles - k} marbles · ${k}/${line.length}`,
    });
    this.player = player;
    clear(this.detail);
    this.detail.append(
      h("p", {}, `Best play from after move ${i} finishes with ${plural(pos.marbles - line.length, "marble")}.`),
      player.el,
      h("div.row",
        {},
        h("button", { onclick: () => this.select(i) }, "Back to review"),
        h("button.primary", { onclick: () => this.actions.onPlayFrom([...this.moves.slice(0, i), ...player.moves]) }, "Play from this point"),
      ),
    );
    void player.play();
  }
}
