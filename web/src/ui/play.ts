// Solo play: choose a starting hole, play with the coach at the level you pick, then
// review the game.

import { type App, type Screen, storageGet, storageSet } from "../app";
import { type Cell, HOLES, label } from "../board/geometry";
import { Cancelled } from "../coach/client";
import { heatColor, holeSolution } from "../data/solutions";
import { type SavedGame, Saves, newGameId } from "../game/saves";
import { Game, type Move, makeMove, startBoard, toWire } from "../game/state";
import { sounds } from "../render/audio";
import { GameController } from "./controller";
import { clear, flash, formatTime, h, plural } from "./dom";
import { miniBoard } from "./miniboard";
import { LinePlayer } from "./playback";
import { explain } from "../review/explain";
import { applyPerformance } from "../review/rating";
import { ReviewScreen } from "./review";

export type CoachLevel = "off" | "warn" | "hint" | "show";

const LEVELS: { id: CoachLevel; name: string; blurb: string }[] = [
  { id: "off", name: "Off", blurb: "No help while you play. You still get the full review at the end." },
  { id: "warn", name: "Warn", blurb: "The board flashes red when a jump makes your best possible finish worse." },
  { id: "hint", name: "Hint", blurb: "See your best possible finish live, and ask for the best move." },
  { id: "show", name: "Show me", blurb: "Reveal the coach's move as an arrow (you still play it), or step through its whole line from here." },
];

const fullBoard = () => Uint8Array.from({ length: 49 }, (_, i) => (HOLES.includes(i) ? 1 : 0));
const marbleWord = (n: number) => plural(n, "marble");

export class PlayScreen implements Screen {
  private ctl: GameController | null = null;
  private level: CoachLevel = (storageGet("coach-level") as CoachLevel) || "warn";
  private startedAt = 0;
  private elapsed = 0;
  private timer = 0;
  private gen = 0; // bumps on every position change; stale coach answers are dropped
  private preview: LinePlayer | null = null;
  private spoilers = false;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private els: Record<string, HTMLElement> = {};
  private saves = new Saves();
  private saveId: string | null = null;
  /** Move numbers at which the coach showed a move or a line, and takebacks so far. */
  private help = new Set<number>();
  private takebacks = 0;
  /** Set for practice games: the first `from` moves were the solver's. */
  private practice: { from: number } | null = null;
  private onPageHide = () => this.persist();

  constructor(private app: App, resume?: { start: Cell; moves: Move[]; practiceFrom?: number }) {
    window.addEventListener("keydown", this.keyHandler);
    window.addEventListener("pagehide", this.onPageHide);
    const active = this.saves.activeId();
    const saved = active ? this.saves.get(active) : undefined;
    if (resume) {
      const from = resume.practiceFrom;
      this.begin(resume.start, resume.moves, from ? { practice: { from }, help: [...Array(from).keys()] } : {});
      // A #/play/<hole> link starts one game; reloading should resume it, not start another.
      history.replaceState(null, "", "#/play");
    } else if (saved) this.resumeSaved(saved);
    else this.pick();
  }

  unmount() {
    this.persist();
    this.stopTimer();
    this.preview?.stop();
    this.ctl?.detach();
    this.app.coach?.cancel("live");
    this.app.view.setHeat(null);
    this.app.view.setHint(null);
    window.removeEventListener("keydown", this.keyHandler);
    window.removeEventListener("pagehide", this.onPageHide);
  }

  // ── Choosing the starting hole ───────────────────────────────────────

  private pick() {
    const { view } = this.app;
    // Leaving a game keeps it in the list, unless no move was made in it.
    const g = this.ctl?.game;
    if (g && this.saveId) {
      if (g.canUndo) this.persist();
      else this.saves.remove(this.saveId);
    }
    this.saves.setActive(null);
    this.saveId = null;
    this.ctl?.detach();
    this.ctl = null;
    this.stopTimer();
    view.setBoard(fullBoard());
    view.setMode("pick");
    view.events = { onHoleClick: (cell) => void this.choose(cell) };
    this.showSpoilers(this.spoilers);
    this.renderPick();
  }

  private renderPick() {
    const { panel } = this.app;
    const spoilerToggle = h("input", { type: "checkbox", checked: this.spoilers, onchange: (e: Event) => this.showSpoilers((e.target as HTMLInputElement).checked) });
    clear(panel);
    panel.append(
      h("section.card",
        {},
        h("h2", {}, "Choose your starting hole"),
        h("p", {}, "Tap any marble to lift it out. Then jump marbles over each other, orthogonally, into empty holes. Each jumped marble comes off. Leave as few as you can."),
        h("div.row",
          {},
          h("button.primary", { onclick: () => void this.choose(HOLES[Math.floor(Math.random() * HOLES.length)]) }, "Random hole"),
          h("button", { onclick: () => void this.choose(18) }, "Your photo's hole (e5)"),
        ),
        h("label.toggle", {}, spoilerToggle, " Show the best possible finish for every hole"),
      ),
      this.gamesCard(),
    );
  }

  // ── Saved games ──────────────────────────────────────────────────────

  private persist() {
    const g = this.ctl?.game;
    if (!g || !this.saveId) return;
    const prev = this.saves.get(this.saveId);
    const moves = g.history.map(toWire);
    const sameMoves = !!prev && JSON.stringify(prev.moves) === JSON.stringify(moves);
    this.saves.put({
      id: this.saveId, start: g.start, moves, elapsed: this.elapsed, updated: Date.now(),
      help: [...this.help], takebacks: this.takebacks, practice: this.practice ?? undefined,
      analysis: sameMoves ? prev.analysis : undefined,
      rated: prev?.rated,
    });
  }

  /** The coach just showed the player a move or a line at the current position. */
  private markHelp(count = 1) {
    const at = this.ctl?.game.history.length ?? 0;
    for (let i = 0; i < count; i++) this.help.add(at + i);
    this.persist();
  }

  /** Help and takebacks carried into a branch that keeps the first `moves` moves. */
  private carried(moves: number) {
    return { help: [...this.help].filter((i) => i < moves), takebacks: this.takebacks, practice: this.practice };
  }

  private resumeSaved(saved: SavedGame) {
    this.persist();
    try {
      this.begin(saved.start, saved.moves.map(([f, t]) => makeMove(f, t)), {
        id: saved.id, elapsed: saved.elapsed, help: saved.help, takebacks: saved.takebacks, practice: saved.practice,
      });
    } catch {
      this.saves.remove(saved.id); // unreadable save
      this.pick();
    }
  }

  /** Every saved game except the one on the board, newest first. */
  private gamesCard(): Node {
    const rows: HTMLElement[] = [];
    for (const saved of this.saves.list()) {
      if (saved.id === this.saveId) continue;
      let game: Game;
      try {
        game = Game.replay(saved.start, saved.moves);
      } catch {
        continue;
      }
      const status = game.isOver
        ? `Finished · ${marbleWord(game.marbles)} left`
        : `${game.marbles} left · ${plural(saved.moves.length, "move")} · ${formatTime(saved.elapsed)}`;
      rows.push(h("li.game-row",
        { onclick: () => this.resumeSaved(saved), title: "Switch to this game" },
        miniBoard(saved.start, saved.moves, 46),
        h("div.who", {}, h("span.name", {}, `Started at ${label(saved.start)}`), h("span.muted", {}, status)),
        h("button.icon.small", {
          title: "Delete this game",
          onclick: (e: Event) => {
            e.stopPropagation();
            this.saves.remove(saved.id);
            if (this.ctl) this.renderPlay();
            else this.renderPick();
          },
        }, "✕"),
      ));
    }
    if (!rows.length) return document.createDocumentFragment();
    return h("section.card", {}, h("h3", {}, this.ctl ? "Your other games" : "Continue a game"), h("ul.games", {}, ...rows));
  }

  private showSpoilers(on: boolean) {
    this.spoilers = on;
    const sol = this.app.solutions;
    this.app.view.setHeat(on && sol ? sol.holes.map((s) => ({ cell: s.cell, color: heatColor(s.best), text: String(s.best) })) : null);
  }

  private async choose(cell: Cell) {
    const { view } = this.app;
    view.events = {};
    view.setHeat(null);
    await view.removeMarble(cell);
    this.begin(cell, []);
  }

  // ── Playing ──────────────────────────────────────────────────────────

  /** Start or resume a game; pass the saved id to keep writing to the same save. */
  private begin(
    start: Cell, moves: Move[],
    opts: { id?: string | null; elapsed?: number; help?: number[]; takebacks?: number; practice?: { from: number } | null } = {},
  ) {
    this.preview?.stop();
    this.preview = null;
    this.app.view.setHeat(null);
    if (moves.length === 0) this.app.view.setBoard(startBoard(start));
    this.ctl?.detach();
    this.ctl = new GameController(this.app.view, start, moves);
    this.ctl.onChange = (kind) => this.onPositionChange(kind === "move");
    this.saveId = opts.id ?? newGameId();
    this.saves.setActive(this.saveId);
    this.elapsed = opts.elapsed ?? 0;
    this.help = new Set((opts.help ?? []).filter((i) => i <= moves.length));
    this.takebacks = opts.takebacks ?? 0;
    this.practice = opts.practice ?? null;
    this.persist();
    this.startTimer();
    this.renderPlay();
    this.onPositionChange();
  }

  private startTimer() {
    this.stopTimer();
    this.startedAt = performance.now() - this.elapsed;
    this.timer = window.setInterval(() => {
      this.elapsed = performance.now() - this.startedAt;
      if (this.els.time) this.els.time.textContent = formatTime(this.elapsed);
    }, 250);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = 0;
  }

  private get bestFromStart(): number | null {
    const g = this.ctl?.game;
    return g && this.app.solutions ? holeSolution(this.app.solutions, g.start)?.best ?? null : null;
  }

  private renderPlay() {
    const { panel } = this.app;
    const g = this.ctl!.game;
    const stat = (name: string, key: string) => h("div.stat", {}, h("span.stat-value", { id: key }), h("span.stat-name", {}, name));
    const marbles = stat("marbles", "marbles"), moves = stat("moves", "moves"), time = stat("time", "time");
    this.els = {
      marbles: marbles.firstChild as HTMLElement,
      moves: moves.firstChild as HTMLElement,
      time: time.firstChild as HTMLElement,
      undo: h("button", { title: "Undo (Ctrl/⌘+Z)", onclick: () => void this.undo() }, "↶ Undo"),
      redo: h("button", { title: "Redo (Shift+Ctrl/⌘+Z)", onclick: () => void this.ctl?.redo() }, "↷ Redo"),
      coach: h("div.coach-body"),
      seg: h("div.seg"),
    };
    for (const l of LEVELS) {
      this.els.seg.append(h("button", { class: l.id === this.level ? "on" : "", onclick: () => this.setLevel(l.id) }, l.name));
    }
    const best = this.bestFromStart;
    clear(panel);
    panel.append(
      h("section.card",
        {},
        h("div.card-head", {},
          h("h2", {}, this.practice ? `Practice from move ${this.practice.from + 1}` : `Started at ${label(g.start)}`),
          this.practice ? h("span.pill", {}, "unrated") : best !== null ? h("span.pill", {}, `best possible: ${best}`) : null),
        h("div.stats", {}, marbles, moves, time),
        h("div.row", {}, this.els.undo, this.els.redo, h("span.spacer"), h("button.ghost", { onclick: () => this.pick(), title: "This game stays saved below" }, "New game")),
      ),
      h("section.card", {}, h("div.card-head", {}, h("h3", {}, "Coach")), this.els.seg, this.els.coach),
      this.gamesCard(),
    );
    this.updateStats();
    this.renderCoach();
  }

  private updateStats() {
    const g = this.ctl?.game;
    if (!g || !this.els.marbles) return;
    this.els.marbles.textContent = String(g.marbles);
    this.els.moves.textContent = String(g.history.length);
    this.els.time.textContent = formatTime(this.elapsed);
    // With no moves made, Undo puts the starting marble back so you can pick another hole.
    this.els.undo.textContent = g.canUndo ? "↶ Undo" : "↶ Change hole";
    this.els.undo.title = g.canUndo ? "Undo (Ctrl/⌘+Z)" : "Put the starting marble back and choose a different hole";
    (this.els.redo as HTMLButtonElement).disabled = !g.canRedo;
  }

  private undo(): Promise<void> {
    if (!this.ctl?.game.canUndo) return this.unpick();
    this.takebacks++;
    return this.ctl.undo();
  }

  /** Before the first move: return the starting marble to its hole and choose again. */
  private async unpick() {
    const ctl = this.ctl;
    if (!ctl || ctl.game.canUndo) return;
    await ctl.settle();
    ctl.detach();
    this.ctl = null;
    this.stopTimer();
    if (this.saveId) this.saves.remove(this.saveId);
    this.saveId = null;
    await this.app.view.restoreMarble(ctl.game.start);
    this.pick();
  }

  private setLevel(level: CoachLevel) {
    this.level = level;
    storageSet("coach-level", level);
    this.app.view.setHint(null);
    [...this.els.seg.children].forEach((b, i) => b.classList.toggle("on", LEVELS[i].id === level));
    this.renderCoach();
    this.refreshMeter();
  }

  private renderCoach() {
    const body = this.els.coach;
    clear(body);
    body.append(h("p.muted", {}, LEVELS.find((l) => l.id === this.level)!.blurb));
    if (!this.app.coach) {
      body.append(h("p.notice", {}, "The coach engine couldn't load in this browser. Play works without it."));
      return;
    }
    if (this.level === "hint" || this.level === "show") {
      this.els.meter = h("div.meter", {}, "…");
      body.append(this.els.meter);
    }
    if (this.level === "hint") body.append(h("div.row", {}, h("button.primary", { onclick: () => void this.hint(), title: "H" }, "Hint")));
    if (this.level === "show") {
      body.append(h("div.row",
        {},
        h("button.primary", { onclick: () => void this.coachMove() }, "Show coach's move"),
        h("button", { onclick: () => void this.showLine() }, "Show the full line"),
      ));
    }
    this.els.status = h("div.status");
    body.append(this.els.status);
  }

  private setStatus(content: (Node | string)[] | null, kind = "") {
    const s = this.els.status;
    if (!s) return;
    clear(s);
    s.className = `status ${kind}`;
    if (content) s.append(...content);
  }

  /** After every move, undo or redo: stats, coach feedback, end of game. */
  private onPositionChange(newMove = false) {
    const g = this.ctl!.game;
    const gen = ++this.gen;
    this.updateStats();
    this.persist();
    this.setStatus(null);
    this.app.coach?.cancel("live");
    void this.ctl!.settle().then(() => {
      if (gen === this.gen && g.isOver) this.finish();
    });
    if (!this.app.coach || this.level === "off") return;
    this.refreshMeter();
    if (this.level === "warn" && newMove) void this.checkMove(gen);
  }

  private async refreshMeter() {
    const coach = this.app.coach, g = this.ctl?.game, meter = this.els.meter;
    if (!coach || !g || !meter || !(this.level === "hint" || this.level === "show")) return;
    const gen = this.gen;
    meter.innerHTML = "";
    meter.append("Best possible from here: ", h("span.thinking", {}, "thinking…"));
    try {
      const v = await coach.value(g.bits(), { priority: 10, group: "live" });
      if (gen !== this.gen) return;
      clear(meter);
      meter.append("Best possible from here: ", h("strong", { class: v <= (this.bestFromStart ?? v) ? "good" : "" }, marbleWord(v)));
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    }
  }

  /** Warn level: did the last move make the best possible finish worse? */
  private async checkMove(gen: number) {
    const coach = this.app.coach!, g = this.ctl!.game;
    const after = g.bits();
    const last = g.history[g.history.length - 1];
    const before = after & ~(1n << BigInt(last.to)) | (1n << BigInt(last.from)) | (1n << BigInt(last.over));
    try {
      const vb = await coach.value(before, { priority: 10, group: "live" });
      const va = await coach.value(after, { priority: 10, group: "live" });
      if (gen !== this.gen || va <= vb) return;
      flash("warn");
      this.setStatus([
        `${label(last.from)}→${label(last.to)} costs you ${marbleWord(va - vb)}: best possible is now ${va}. `,
        h("button.small", { onclick: () => void this.whyLast() }, "Why?"),
        " ",
        h("button.small", { onclick: () => void this.undo() }, "Undo it"),
      ], "warn");
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    }
  }

  /** Explain why the last move cost marbles, by comparing exact lines. */
  private async whyLast() {
    const coach = this.app.coach, ctl = this.ctl;
    const last = ctl?.game.history[ctl.game.history.length - 1];
    if (!coach || !ctl || !last) return;
    const gen = this.gen;
    const before = Game.replay(ctl.game.start, ctl.game.history.slice(0, -1));
    this.setStatus([h("span.thinking", {}, "Working out why…")], "warn");
    try {
      const [lb, la] = await Promise.all([
        coach.bestLine(before.bits(), { priority: 10, group: "live" }),
        coach.bestLine(ctl.game.bits(), { priority: 10, group: "live" }),
      ]);
      if (gen !== this.gen) return;
      const e = explain(before.board, last, lb, la);
      this.setStatus([
        ...e.reasons.map((r) => h("p", {}, r)),
        h("div.row", {},
          h("button.small", { onclick: () => void this.undo() }, "Undo it"),
          e.principle ? h("a.principle-link", { href: `#/learn/${e.principle}` }, `Principle ${e.principle} →`) : null),
      ], "warn");
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
    }
  }

  private async hint() {
    const coach = this.app.coach, g = this.ctl?.game;
    if (!coach || !g || g.isOver) return;
    const gen = this.gen;
    this.setStatus([h("span.thinking", {}, "Finding the best move…")]);
    try {
      const line = await coach.bestLine(g.bits(), { priority: 10, group: "live" });
      if (gen !== this.gen || !line.length) return;
      this.app.view.setHint(line[0]);
      this.markHelp();
      this.setStatus([`Try ${label(line[0].from)} → ${label(line[0].to)}: follow the arrow.`], "hint");
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    }
  }

  /** Reveal the coach's move as an arrow; the player still makes it. */
  private async coachMove() {
    const coach = this.app.coach, ctl = this.ctl;
    if (!coach || !ctl || ctl.game.isOver) return;
    const gen = this.gen;
    this.setStatus([h("span.thinking", {}, "Thinking…")]);
    try {
      const line = await coach.bestLine(ctl.game.bits(), { priority: 10, group: "live" });
      if (gen !== this.gen || !line.length) return;
      this.app.view.setHint(line[0]);
      this.markHelp();
      this.setStatus([`Coach's move: ${label(line[0].from)} → ${label(line[0].to)}. Follow the arrow and play it yourself.`], "hint");
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    }
  }

  private async showLine() {
    const coach = this.app.coach, ctl = this.ctl;
    if (!coach || !ctl || ctl.game.isOver) return;
    this.setStatus([h("span.thinking", {}, "Working out the best line…")]);
    let line: Move[];
    try {
      line = await coach.bestLine(ctl.game.bits(), { priority: 10, group: "live" });
    } catch (e) {
      if (e instanceof Cancelled) return;
      throw e;
    }
    await ctl.settle();
    this.markHelp();
    ctl.detach();
    this.stopTimer();
    const finish = ctl.game.marbles - line.length;
    const marbles = ctl.game.marbles;
    const player = new LinePlayer(this.app.view, line, { caption: (k) => `${marbles - k} marbles · move ${k}/${line.length}` });
    this.preview = player;
    const { panel } = this.app;
    clear(panel);
    panel.append(h("section.card",
      {},
      h("h2", {}, "The coach's line"),
      h("p", {}, `From your current position, best play finishes with ${marbleWord(finish)}.`),
      player.el,
      h("div.row",
        {},
        h("button.primary", { onclick: () => this.leavePreview(false) }, "Back to my game"),
        h("button", { onclick: () => this.leavePreview(true) }, "Continue from here"),
      ),
    ));
  }

  private leavePreview(adopt: boolean) {
    const player = this.preview, ctl = this.ctl;
    if (!player || !ctl) return;
    player.stop();
    this.preview = null;
    const moves = adopt ? [...ctl.game.history, ...player.moves] : [...ctl.game.history];
    if (adopt) this.markHelp(player.moves.length); // coach-played moves count as help
    this.begin(ctl.game.start, moves, { id: this.saveId, elapsed: this.elapsed, ...this.carried(moves.length) });
  }

  // ── End of game ──────────────────────────────────────────────────────

  private finish() {
    const g = this.ctl!.game;
    this.stopTimer();
    const best = this.bestFromStart;
    const n = g.marbles;
    const perfect = best !== null && n <= best;
    if (perfect) {
      flash("good");
      sounds.land();
    }
    const verdict = best === null
      ? ""
      : perfect
        ? n === 1 ? "A perfect solve: one marble left." : `Optimal: ${marbleWord(best)} is the best anyone can do from ${label(g.start)}.`
        : `The best possible from ${label(g.start)} is ${marbleWord(best)}, ${n - best} fewer than you.`;
    const { panel } = this.app;
    clear(panel);
    panel.append(h("section.card.end",
      {},
      h("div.big", {}, String(n)),
      h("div.big-label", {}, `${n === 1 ? "marble" : "marbles"} left · ${formatTime(this.elapsed)}`),
      h("p", {}, verdict),
      h("div.row",
        {},
        h("button.primary", { onclick: () => this.review() }, "Review game"),
        h("button", { onclick: () => void this.undo().then(() => { this.renderPlay(); this.startTimer(); }) }, "Undo last move"),
      ),
      h("div.row",
        {},
        h("button", { onclick: () => this.begin(g.start, []) }, `Play ${label(g.start)} again`),
        h("button.ghost", { onclick: () => this.pick() }, "New starting hole"),
      ),
    ));
  }

  private review() {
    const g = this.ctl!.game;
    this.persist();
    this.ctl!.detach();
    const start = g.start, moves = [...g.history], id = this.saveId, elapsed = this.elapsed;
    const saved = id ? this.saves.get(id) : undefined;
    const r = new ReviewScreen(this.app, start, moves, {
      onPlayFrom: (prefix) => {
        r.unmount();
        this.begin(start, prefix, { id, elapsed, ...this.carried(prefix.length) });
      },
      onClose: () => {
        r.unmount();
        this.begin(start, moves, { id, elapsed, ...this.carried(moves.length) });
      },
    }, {
      help: new Set(this.help),
      takebacks: this.takebacks,
      fromMove: this.practice?.from ?? 0,
      analysis: saved?.analysis?.moves === moves.length ? saved.analysis : undefined,
      onAnalysis: (a) => {
        const cur = id ? this.saves.get(id) : undefined;
        if (cur) this.saves.put({ ...cur, analysis: { ...a, moves: moves.length } });
      },
      rate: (perf) => {
        const cur = id ? this.saves.get(id) : undefined;
        if (!cur || !g.isOver || cur.practice) return null;
        if (cur.rated) return { ...cur.rated, fresh: false };
        const rated = { perf, ...applyPerformance(perf) };
        this.saves.put({ ...cur, rated });
        return { ...rated, fresh: true };
      },
    });
  }

  private onKey(e: KeyboardEvent) {
    if (!this.ctl || this.preview) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      void (e.shiftKey ? this.ctl.redo() : this.undo());
    } else if (!mod && e.key.toLowerCase() === "h" && this.level === "hint") void this.hint();
  }
}
