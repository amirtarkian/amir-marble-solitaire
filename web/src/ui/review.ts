// Post-game review: a performance rating, a graph of how the game went (difficulty of
// every position and the odds of each finish), every move graded, a plain-language "why"
// for each costly move, and personal advice on what to work on.

import { type App, storageGet, storageSet } from "../app";
import { type Cell, label } from "../board/geometry";
import { Cancelled } from "../coach/client";
import { Game, type Move } from "../game/state";
import { type Explanation, explain } from "../review/explain";
import {
  type Analysis, type GradedMove, KIND_LABEL, SKILL_PRESETS, estimateSkill, gradeMoves, pathOdds, performanceRating, ratingTitle,
} from "../review/grade";
import { clear, h, plural } from "./dom";
import { OddsChart } from "./odds-chart";
import { LinePlayer } from "./playback";

export interface ReviewActions {
  onPlayFrom: (moves: Move[]) => void;
  onClose: () => void;
}

export interface ReviewExtras {
  /** Move numbers at which the coach showed a move or a line. */
  help?: ReadonlySet<number>;
  takebacks?: number;
  /** Practice games: moves before this were the solver's and aren't graded as yours. */
  fromMove?: number;
  /** A finished analysis from an earlier visit. */
  analysis?: Analysis;
  onAnalysis?: (a: Analysis) => void;
  /** Count this game toward the running rating (once); null if it can't be rated. */
  rate?: (perf: number) => { perf: number; before: number | null; after: number; fresh: boolean } | null;
}

const PRINCIPLE_NAMES: Record<number, string> = {
  2: "Know where you're heading",
  3: "Corners can't be captured",
  4: "Clear blocks in packages",
  5: "Lonely marbles are fine, if you can reach them",
  6: "The middle game decides it",
  7: "Plan the finish backwards",
};

/** "move 12", "moves 12 and 20", "moves 3, 12 and 20". */
const movesList = (ms: number[]) =>
  ms.length === 1 ? `move ${ms[0]}` : `moves ${ms.slice(0, -1).join(", ")} and ${ms[ms.length - 1]}`;

const principleLink = (n: number | null) =>
  n ? h("a.principle-link", { href: `#/learn/${n}` }, `Principle ${n}: ${PRINCIPLE_NAMES[n] ?? ""} →`) : null;

export class ReviewScreen {
  private n: number;
  /** values[i] = best possible finish after the first i moves. */
  private values: (number | null)[];
  private good: number[];
  private total: number[];
  private graded: GradedMove[] | null = null;
  private skill: number | null = null;
  private explanations = new Map<number, Explanation>();
  private selected: number;
  /** Which position the board shows (null while it shows something else). */
  private boardAt: number | null = null;
  private anim: Promise<void> = Promise.resolve();
  private chips: HTMLButtonElement[] = [];
  private header = h("div.grade-header");
  private detail = h("div.detail");
  private advice = h("section.card.advice");
  private chart: OddsChart;
  private skillSeg = h("div.seg.skill");
  private skillChoice = storageGet("review-skill") ?? "you";
  private finalOver: boolean;
  private help: ReadonlySet<number>;
  private takebacks: number;
  private player: LinePlayer | null = null;
  private closed = false;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(private app: App, private start: Cell, private moves: Move[], private actions: ReviewActions, private extras: ReviewExtras = {}) {
    this.n = moves.length;
    this.values = new Array(this.n + 1).fill(null);
    this.good = new Array(this.n).fill(0);
    this.total = new Array(this.n).fill(0);
    this.help = extras.help ?? new Set();
    this.takebacks = extras.takebacks ?? 0;
    this.selected = this.n;
    this.finalOver = Game.replay(start, moves).isOver;
    this.chart = new OddsChart(this.n, (i) => this.select(i));
    window.addEventListener("keydown", this.keyHandler);
    this.render();
    void this.analyse();
  }

  unmount() {
    this.closed = true;
    this.player?.stop();
    this.app.coach?.cancel("review");
    this.app.view.setHint(null);
    this.app.view.setHeat(null);
    window.removeEventListener("keydown", this.keyHandler);
  }

  private position(i: number): Game {
    return Game.replay(this.start, this.moves.slice(0, i));
  }

  // ── Analysis ─────────────────────────────────────────────────────────

  private async analyse() {
    const cached = this.extras.analysis;
    if (cached) {
      this.values = [...cached.values];
      this.good = [...cached.good];
      this.total = [...cached.total];
      this.finishAnalysis(false);
      return;
    }
    const coach = this.app.coach;
    if (!coach) {
      this.header.textContent = "The coach engine isn't available, so this game can't be graded.";
      return;
    }
    try {
      // Pass 1: the best possible finish after every move (fast; draws the strip and chips).
      for (let i = 0; i <= this.n && !this.closed; i++) {
        this.values[i] = await coach.value(this.position(i).bits(), { group: "review" });
        this.paintChip(i);
        this.refresh();
      }
      // Pass 2: how many moves were good at each position. End first, where it's cheap,
      // so the odds lines grow in from the right.
      for (let j = this.n - 1; j >= 0 && !this.closed; j--) {
        const gr = await coach.grades(this.position(j).bits(), { group: "review" });
        this.good[j] = gr.moves.filter((m) => m.good).length;
        this.total[j] = gr.moves.length;
        this.refresh();
      }
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
      return;
    }
    if (!this.closed) this.finishAnalysis(true);
  }

  private finishAnalysis(fresh: boolean) {
    const a = this.analysisData();
    if (fresh) this.extras.onAnalysis?.(a);
    this.graded = gradeMoves(a, this.help);
    this.skill = estimateSkill(this.graded.slice(this.extras.fromMove ?? 0));
    this.chips.forEach((_, k) => this.paintChip(k + 1));
    this.renderSkills();
    this.renderHeader();
    this.refresh();
    this.renderDetail();
    void this.buildAdvice();
  }

  private analysisData(): Analysis {
    return { values: this.values as number[], good: this.good, total: this.total };
  }

  /** Marbles lost by move i (1-based), once both sides are known. */
  private cost(i: number): number | null {
    const a = this.values[i - 1], b = this.values[i];
    return a === null || b === null ? null : b - a;
  }

  private chosenSkill(): number {
    return SKILL_PRESETS.find((p) => p.id === this.skillChoice)?.skill ?? this.skill ?? 0.55;
  }

  private refresh() {
    this.chart.update({
      moves: this.moves,
      values: this.values,
      odds: pathOdds(this.analysisData(), this.chosenSkill(), this.finalOver),
      good: this.good,
      total: this.total,
      kinds: this.graded ? this.graded.map((g) => g.kind) : this.moves.map(() => null),
      selected: this.selected,
    });
  }

  // ── Panels ───────────────────────────────────────────────────────────

  private renderHeader() {
    const hd = this.header;
    clear(hd);
    if (!this.graded || this.skill === null) {
      hd.append(h("p.muted", {}, "Grading your game…"));
      return;
    }
    const perf = performanceRating(this.skill, this.takebacks);
    const rated = this.extras.rate?.(perf) ?? null;
    const count = (k: GradedMove["kind"]) => this.graded!.filter((g) => g.kind === k).length;
    const costly = this.graded.filter((g) => g.cost > 0);
    const lost = costly.reduce((s, g) => s + g.cost, 0);
    hd.append(
      h("div.perf",
        {},
        h("div.perf-num", {}, String(perf)),
        h("div.perf-meta", {},
          h("div.perf-title", {}, `${ratingTitle(perf)} performance`),
          rated
            ? h("div.muted", {}, rated.before === null
              ? `Your first rated game: rating ${rated.after}`
              : rated.fresh
                ? `Rating ${rated.before} → ${rated.after} (${rated.after >= rated.before ? "+" : ""}${rated.after - rated.before})`
                : `Counted toward your rating (now ${rated.after})`)
            : h("div.muted", {}, this.extras.fromMove ? `Practice game: not rated (graded from move ${this.extras.fromMove + 1})` : "Not rated (only finished solo games count)"),
        ),
      ),
      h("div.grade-counts",
        {},
        ...(["only", "best", "mistake", "blunder", "helped"] as const).map((k) =>
          h("span", { class: `gc ${k}` }, h("strong", {}, String(count(k))), ` ${KIND_LABEL[k].toLowerCase()}${count(k) === 1 || k === "best" ? "" : "s"}`)),
        h("span.gc", {}, h("strong", {}, String(this.takebacks)), ` takeback${this.takebacks === 1 ? "" : "s"}`),
      ),
      h("p.summary", {}, costly.length
        ? `${plural(costly.length, "move")} cost you ${plural(lost, "marble")}. The red and gold markers on the graph show where.`
        : `Every move kept your best possible finish at ${plural(this.values[0]!, "marble")}.`),
      h("details.model-note", {},
        h("summary", {}, "How is this worked out?"),
        h("p", {}, "For every position you faced, the solver counts how many legal moves keep your best finish alive: the bars on the graph. Your skill is estimated from which moves you found, with more credit for finding the move when few moves work. Coach help counts as not finding it, and each takeback costs 25 points. The rating is 400 + 2000 × skill, so 1400 means you see the right move about half the time beyond lucky guesses."),
      ),
    );
  }

  private renderSkills() {
    const seg = this.skillSeg;
    clear(seg);
    const you = this.skill === null ? "You" : `You ${performanceRating(this.skill, 0)}`;
    const options = [{ id: "you", name: you, title: "Your skill in this game" }, ...SKILL_PRESETS.map((p) => ({ id: p.id, name: p.name, title: `About ${performanceRating(p.skill, 0)}` }))];
    for (const o of options) {
      seg.append(h("button", {
        class: o.id === this.skillChoice ? "on" : "",
        title: o.title,
        onclick: () => {
          this.skillChoice = o.id;
          storageSet("review-skill", o.id);
          this.renderSkills();
          this.refresh();
        },
      }, o.name));
    }
  }

  private paintChip(i: number) {
    const chip = this.chips[i - 1];
    if (!chip) return;
    chip.className = "chip";
    const g = this.graded?.[i - 1];
    if (g) chip.classList.add(g.kind === "best" || g.kind === "forced" ? "ok" : g.kind === "mistake" ? "minor" : g.kind === "blunder" ? "major" : g.kind);
    else {
      const c = this.cost(i);
      chip.classList.add(c === null ? "pending" : c === 0 ? "ok" : c === 1 ? "minor" : "major");
    }
    if (i === this.selected) chip.classList.add("sel");
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
    this.renderHeader();
    clear(panel);
    panel.append(
      h("section.card",
        {},
        h("div.card-head", {}, h("h2", {}, "Game review"), h("button.ghost.small", { onclick: () => this.actions.onClose() }, "Close")),
        this.header,
      ),
      h("section.card",
        {},
        h("h3", {}, "How the game went"),
        this.chart.el,
        h("div.skill-row", {}, h("span.muted", {}, "Odds for"), this.skillSeg),
        h("div.row", {}, h("button", { onclick: () => this.replayGame() }, "▶ Replay my game"), h("span.muted", {}, "or use ← → to step")),
      ),
      h("section.card",
        {},
        h("h3", {}, "Moves"),
        h("div.legend", {},
          h("span.chip.only", {}, ""), " only move ", h("span.chip.ok", {}, ""), " best ", h("span.chip.helped", {}, ""), " coach ",
          h("span.chip.minor", {}, ""), " mistake ", h("span.chip.major", {}, ""), " blunder"),
        timeline,
        this.detail,
      ),
      this.advice,
    );
    this.advice.append(h("h3", {}, "How to get better"), h("p.muted", {}, "Personal advice appears once the game is graded."));
    this.select(this.n);
  }

  /** Show the position after move i; neighbouring moves animate, longer jumps snap. */
  private select(i: number) {
    i = Math.max(0, Math.min(this.n, i));
    this.player?.stop();
    this.player = null;
    const from = this.boardAt;
    this.selected = i;
    this.boardAt = i;
    this.chips.forEach((c, k) => c.classList.toggle("sel", k + 1 === i));
    const { view } = this.app;
    view.setHint(null);
    view.setHeat(null);
    view.setMode("view");
    if (from === i - 1) this.anim = this.anim.then(() => view.playMove(this.moves[i - 1], 1.6));
    else if (from === i + 1) this.anim = this.anim.then(() => view.undoMove(this.moves[i], 1.6));
    else this.anim = this.anim.then(() => view.setBoard(this.position(i).board));
    this.refresh();
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
    this.app.view.setHeat(null);
    this.app.view.setBoard(new Game(this.start).board);
    this.boardAt = null;
    const player = new LinePlayer(this.app.view, this.moves, {
      caption: (k) => `Your move ${k}/${this.n}`,
      onStep: (k) => {
        this.selected = k;
        this.chips.forEach((c, j) => c.classList.toggle("sel", j + 1 === k));
        this.refresh();
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
      const m = this.moves[i - 1], c = this.cost(i), g = this.graded?.[i - 1];
      const hard = this.total[i - 1] ? ` ${this.good[i - 1]} of ${plural(this.total[i - 1], "move")} kept your best here.` : "";
      d.append(h("p", {},
        h("strong", {}, `Move ${i}: ${label(m.from)} → ${label(m.to)}. `),
        c === null ? "Grading…" : c === 0 ? `${g ? KIND_LABEL[g.kind] : "Optimal"}.` : `Cost ${plural(c, "marble")}: best possible went from ${this.values[i - 1]} to ${this.values[i]}.`,
        hard,
      ));
      if (c !== null && c > 0) {
        const why = h("div.why", {}, h("p.thinking", {}, "Working out why…"));
        d.append(why);
        void this.explainMove(i).then((e) => {
          if (this.selected !== i || this.player || !e) return;
          clear(why);
          why.append(
            h("p.why-title", {}, "Why it cost you"),
            ...e.reasons.map((r) => h("p", {}, r)),
            h("div.row", {},
              h("button", { onclick: () => void this.showStuck(i) }, "Show where it gets stuck"),
              principleLink(e.principle)),
          );
        });
      }
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

  // ── Explanations ─────────────────────────────────────────────────────

  private async explainMove(i: number): Promise<Explanation | null> {
    const known = this.explanations.get(i);
    if (known) return known;
    const coach = this.app.coach;
    if (!coach) return null;
    const before = this.position(i - 1), after = this.position(i);
    try {
      const [lb, la] = await Promise.all([
        coach.bestLine(before.bits(), { priority: 5, group: "review" }),
        coach.bestLine(after.bits(), { priority: 5, group: "review" }),
      ]);
      const e = explain(before.board, this.moves[i - 1], lb, la);
      this.explanations.set(i, e);
      return e;
    } catch (err) {
      if (err instanceof Cancelled) return null;
      throw err;
    }
  }

  /** The end of best play after move i, with the marbles it can't get rid of marked. */
  private async showStuck(i: number) {
    const coach = this.app.coach, e = await this.explainMove(i);
    if (!coach || !e) return;
    const after = this.position(i);
    const line = await coach.bestLine(after.bits(), { priority: 10, group: "review" });
    await this.anim;
    this.player?.stop();
    this.player = null;
    const end = after.board.slice();
    for (const m of line) {
      end[m.from] = 0;
      end[m.over] = 0;
      end[m.to] = 1;
    }
    this.boardAt = null;
    this.app.view.setHint(null);
    this.app.view.setBoard(end);
    this.app.view.setHeat(e.stuck.map((cell) => ({ cell, color: "#e5603c", text: "✕" })));
  }

  // ── Coaching ─────────────────────────────────────────────────────────

  private async buildAdvice() {
    const graded = this.graded;
    if (!graded) return;
    const costly = graded.map((g, k) => ({ ...g, i: k + 1 })).filter((g) => g.cost > 0);
    for (const c of costly) await this.explainMove(c.i);
    if (this.closed) return;
    const tips: { text: string; principle?: number; drill?: number }[] = [];
    if (!costly.length) {
      tips.push({ text: this.help.size
        ? "No move cost you anything, but the coach helped. Next time try the same start on Warn: it only speaks up after a mistake."
        : "A clean game: no move cost you a marble. Try a harder start (a one-marble hole like d5 or c7), or turn the coach Off." });
    } else {
      const at = costly.map((c) => c.i);
      const phase = (lo: number, hi: number) => at.filter((i) => i >= lo && i <= hi);
      const mid = phase(8, 20), late = phase(21, 99), early = phase(1, 7);
      if (mid.length >= Math.max(late.length, early.length)) {
        tips.push({ text: `Your costly moves came in the middle game (${movesList(mid)}), where most games are decided. From about move 8 to 20, check each jump against the principles before you play it.`, principle: 6 });
      } else if (late.length >= early.length) {
        tips.push({ text: `Your costly moves came late (${movesList(late)}). With about 8 marbles left, stop and plan the finish backwards from one of your four target holes.`, principle: 7 });
      } else {
        tips.push({ text: `You slipped early (${movesList(early)}). Step through this start's opening in Learn to see how the solver begins.`, principle: 2 });
      }
      const byPrinciple = new Map<number, number[]>();
      for (const c of costly) {
        const p = this.explanations.get(c.i)?.principle;
        if (p) byPrinciple.set(p, [...(byPrinciple.get(p) ?? []), c.i]);
      }
      const themes: Record<number, string> = {
        3: "a marble ended up stranded in a corner hole",
        5: "you left a marble alone where nothing could reach it again",
        4: "the group stopped fitting together for a clean finish",
      };
      for (const [p, moves] of byPrinciple) {
        if (themes[p]) tips.push({ text: `At ${movesList(moves)}, ${themes[p]}.`, principle: p });
      }
      tips.push({ text: `Drill: go back to just before move ${at[0]} and find a move that keeps your best finish yourself.`, drill: at[0] - 1 });
    }
    const only = graded.filter((g) => g.kind === "only").length;
    if (only) tips.push({ text: `You found ${plural(only, "only move")}: positions where just one jump kept your best finish. That's the skill that raises your rating.` });
    if (this.help.size) tips.push({ text: `The coach helped at ${plural(this.help.size, "position")}. Each counts as a move you didn't find, which lowers your rating. Hints are for learning; play rated games on Off or Warn.` });
    if (this.takebacks) tips.push({ text: `${plural(this.takebacks, "takeback")} cost you ${Math.min(300, 25 * this.takebacks)} rating points.` });

    const box = this.advice;
    clear(box);
    box.append(
      h("h3", {}, "How to get better"),
      h("ul.advice-list", {}, ...tips.map((t) => h("li", {},
        t.text, " ",
        t.principle ? principleLink(t.principle) : null,
        t.drill !== undefined ? h("button.small", { onclick: () => this.actions.onPlayFrom(this.moves.slice(0, t.drill)) }, "Start the drill") : null,
      ))),
      h("p.muted", {}, h("a.principle-link", { href: "#/learn" }, "All the tenets and principles →")),
    );
  }

  /** Show the position before move i with the best move drawn as an arrow. */
  private async bestInstead(i: number) {
    const coach = this.app.coach;
    if (!coach) return;
    const before = this.position(i - 1);
    await this.anim;
    this.app.view.setHeat(null);
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
    const pos = this.position(i);
    let line: Move[];
    try {
      line = await coach.bestLine(pos.bits(), { priority: 10, group: "review" });
    } catch (e) {
      if (e instanceof Cancelled) return;
      throw e;
    }
    await this.anim;
    this.app.view.setHint(null);
    this.app.view.setHeat(null);
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
