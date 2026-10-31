// Post-game review: a graph of how the game went, every move tagged optimal or
// "+k marbles", a replay of your own game, and the coach's best line from any point.

import { type App, storageGet, storageSet } from "../app";
import { type Cell, label } from "../board/geometry";
import { Cancelled } from "../coach/client";
import { Game, type Move } from "../game/state";
import { PRESETS, accuracyOf } from "../review/odds";
import { clear, h, plural } from "./dom";
import { OddsChart } from "./odds-chart";
import { LinePlayer } from "./playback";

export interface ReviewActions {
  onPlayFrom: (moves: Move[]) => void;
  onClose: () => void;
}

export class ReviewScreen {
  /** values[i] = best possible finish after the first i moves. */
  private values: (number | null)[];
  private selected: number;
  /** Which position the board shows (null while it shows something else, e.g. a best line). */
  private boardAt: number | null = null;
  private anim: Promise<void> = Promise.resolve();
  private chips: HTMLButtonElement[] = [];
  private detail = h("div.detail");
  private summary = h("p.summary");
  private chart: OddsChart;
  private skillSeg = h("div.seg.skill");
  private skill = storageGet("review-skill") ?? "you";
  private finalOver: boolean;
  private player: LinePlayer | null = null;
  private closed = false;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(private app: App, private start: Cell, private moves: Move[], private actions: ReviewActions) {
    this.values = new Array(moves.length + 1).fill(null);
    this.selected = moves.length;
    this.finalOver = Game.replay(start, moves).isOver;
    this.chart = new OddsChart(moves.length, (i) => this.select(i));
    window.addEventListener("keydown", this.keyHandler);
    this.render();
    void this.analyse();
  }

  unmount() {
    this.closed = true;
    this.player?.stop();
    this.app.coach?.cancel("review");
    this.app.view.setHint(null);
    window.removeEventListener("keydown", this.keyHandler);
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
        this.refreshChart();
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
      : `${this.moves.length - costly} of ${this.moves.length} moves were optimal. ${plural(costly, "move")} cost you ${plural(end - start, "marble")} in total. The red markers on the graph show where.`;
    this.renderSkills();
  }

  /** Marbles lost by move i (1-based), once both sides are known. */
  private cost(i: number): number | null {
    const a = this.values[i - 1], b = this.values[i];
    return a === null || b === null ? null : b - a;
  }

  private yourAccuracy(): number {
    return accuracyOf(this.moves.map((_, i) => this.cost(i + 1)));
  }

  private accuracy(): number {
    return PRESETS.find((p) => p.id === this.skill)?.accuracy ?? this.yourAccuracy();
  }

  private refreshChart() {
    this.chart.update({ values: this.values, over: this.finalOver, accuracy: this.accuracy(), selected: this.selected });
  }

  private renderSkills() {
    const seg = this.skillSeg;
    clear(seg);
    const options = [{ id: "you", name: `You ${Math.round(this.yourAccuracy() * 100)}%` }, ...PRESETS];
    for (const o of options) {
      seg.append(h("button", {
        class: o.id === this.skill ? "on" : "",
        title: o.id === "you" ? "Your accuracy in this game" : `${Math.round((o as { accuracy: number }).accuracy * 100)}% of moves optimal`,
        onclick: () => {
          this.skill = o.id;
          storageSet("review-skill", o.id);
          this.renderSkills();
          this.refreshChart();
        },
      }, o.name));
    }
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
    this.renderSkills();
    clear(panel);
    panel.append(
      h("section.card",
        {},
        h("div.card-head", {}, h("h2", {}, "Game review"), h("button.ghost.small", { onclick: () => this.actions.onClose() }, "Close")),
        this.summary,
        this.chart.el,
        h("div.skill-row", {}, h("span.muted", {}, "Odds for"), this.skillSeg),
        h("details.model-note", {},
          h("summary", {}, "How are the odds worked out?"),
          h("p", {}, "The strip under the graph is exact: the solver's best possible finish after each move. Solitaire has no luck, so the odds lines need a model of the player: each remaining move is a slip with probability 1 − accuracy, and each slip costs one marble. Pick an accuracy above to compare."),
        ),
        h("div.row", {}, h("button", { onclick: () => this.replayGame() }, "▶ Replay my game"), h("span.muted", {}, "or use ← → to step")),
      ),
      h("section.card",
        {},
        h("h3", {}, "Moves"),
        h("div.legend", {}, h("span.chip.ok", {}, ""), " optimal ", h("span.chip.minor", {}, ""), " cost 1 ", h("span.chip.major", {}, ""), " cost 2+"),
        timeline,
        this.detail,
      ),
    );
    this.summary.textContent = "Grading your moves…";
    this.select(this.moves.length);
  }

  /** Show the position after move i; neighbouring moves animate, longer jumps snap. */
  private select(i: number) {
    i = Math.max(0, Math.min(this.moves.length, i));
    this.player?.stop();
    this.player = null;
    const from = this.boardAt;
    this.selected = i;
    this.boardAt = i;
    this.chips.forEach((c, k) => c.classList.toggle("sel", k + 1 === i));
    const { view } = this.app;
    view.setHint(null);
    view.setMode("view");
    if (from === i - 1) this.anim = this.anim.then(() => view.playMove(this.moves[i - 1], 1.6));
    else if (from === i + 1) this.anim = this.anim.then(() => view.undoMove(this.moves[i], 1.6));
    else this.anim = this.anim.then(() => view.setBoard(Game.replay(this.start, this.moves.slice(0, i)).board));
    this.refreshChart();
    this.renderDetail();
  }

  private onKey(e: KeyboardEvent) {
    if (this.player || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight") this.select(this.selected + 1);
    else if (e.key === "ArrowLeft") this.select(this.selected - 1);
    else return;
    e.preventDefault();
  }

  private replayGame() {
    this.player?.stop();
    this.app.view.setHint(null);
    this.app.view.setBoard(new Game(this.start).board);
    this.boardAt = null;
    const player = new LinePlayer(this.app.view, this.moves, {
      caption: (k) => `Your move ${k}/${this.moves.length}`,
      onStep: (k) => {
        this.selected = k;
        this.chips.forEach((c, j) => c.classList.toggle("sel", j + 1 === k));
        this.refreshChart();
      },
    });
    this.player = player;
    clear(this.detail);
    this.detail.append(
      h("p", {}, "Replaying your game. The graph follows along; click it to jump."),
      player.el,
      h("div.row", {}, h("button", { onclick: () => this.select(player.position) }, "Back to review")),
    );
    void player.play();
  }

  private renderDetail() {
    if (this.player) return;
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

  /** Show the position before move i with the best move drawn as an arrow. */
  private async bestInstead(i: number) {
    const coach = this.app.coach;
    if (!coach) return;
    const before = Game.replay(this.start, this.moves.slice(0, i - 1));
    await this.anim;
    this.app.view.setBoard(before.board);
    this.boardAt = i - 1;
    this.chips.forEach((c, k) => c.classList.toggle("sel", k + 1 === i));
    try {
      const line = await coach.bestLine(before.bits(), { priority: 10, group: "review" });
      if (!line.length || this.selected !== i) return;
      this.app.view.setHint(line[0]);
      const m = this.moves[i - 1];
      const same = line[0].from === m.from && line[0].to === m.to;
      clear(this.detail);
      this.detail.append(
        h("p", {}, same ? "You found it: that was the coach's choice too." : `Before move ${i}, the coach would play ${label(line[0].from)} → ${label(line[0].to)} (the arrow). You played ${label(m.from)} → ${label(m.to)}.`),
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
    await this.anim;
    this.app.view.setHint(null);
    this.app.view.setBoard(pos.board);
    this.boardAt = null;
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
  }
}
