// Steps through a line of moves on the board. It starts paused with the next move glowing:
// tap or drag that marble yourself, press Next (or →), or hit Play at the speed you pick.
// Used by "Show me", the review's best lines and the solutions explorer.

import { storageGet, storageSet } from "../app";
import { label } from "../board/geometry";
import type { Move } from "../game/state";
import type { BoardView } from "../render/scene";
import { h } from "./dom";

const SPEEDS: { value: number; name: string }[] = [
  { value: 0.5, name: "½×" },
  { value: 1, name: "1×" },
  { value: 2, name: "2×" },
  { value: 4, name: "4×" },
];
const PAUSE_MS = 420; // between moves at 1×

export class LinePlayer {
  readonly el: HTMLElement;
  private index = 0;
  private playing = false;
  private busy = false;
  private stopped = false;
  private speed = Number(storageGet("line-speed")) || 1;
  private counter = h("span.counter");
  private nextText = h("p.player-next");
  private playBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private speedSeg = h("div.seg.speed", { title: "Playback speed" });
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  /** The view must already show the position the line starts from. */
  constructor(private view: BoardView, private line: Move[], private opts: { caption?: (i: number) => string } = {}) {
    this.playBtn = h("button.primary", { onclick: () => this.toggle(), title: "Play / pause (space)" });
    this.backBtn = h("button", { onclick: () => void this.step(-1), title: "Previous move (←)" }, "‹ Back");
    this.nextBtn = h("button", { onclick: () => void this.step(1), title: "Next move (→)" }, "Next ›");
    for (const s of SPEEDS) {
      this.speedSeg.append(h("button", { class: s.value === this.speed ? "on" : "", onclick: () => this.setSpeed(s.value) }, s.name));
    }
    this.el = h("div.player",
      {},
      h("div.player-controls",
        {},
        h("button.icon", { title: "Back to the start", onclick: () => void this.seek(0) }, "⏮"),
        this.backBtn,
        this.playBtn,
        this.nextBtn,
        h("button.icon", { title: "Skip to the end", onclick: () => void this.seek(this.line.length) }, "⏭"),
      ),
      h("div.player-meta", {}, this.counter, h("div.speed-wrap", {}, h("span.muted", {}, "Speed"), this.speedSeg)),
      this.nextText,
    );
    window.addEventListener("keydown", this.keyHandler);
    this.sync();
  }

  get position(): number {
    return this.index;
  }

  get moves(): Move[] {
    return this.line.slice(0, this.index);
  }

  /** Refresh the controls, and let the player make the next move on the board when paused. */
  private sync() {
    if (this.stopped) return;
    const next = this.line[this.index];
    this.counter.textContent = this.opts.caption?.(this.index) ?? `Move ${this.index} / ${this.line.length}`;
    this.playBtn.textContent = this.playing ? "❚❚ Pause" : this.index >= this.line.length ? "↺ Replay" : "▶ Play";
    this.backBtn.disabled = this.index === 0;
    this.nextBtn.disabled = !next;
    this.nextText.textContent = next
      ? `Next: ${label(next.from)} → ${label(next.to)}. Tap the glowing marble to play it yourself, or press Next.`
      : "That's the end of the line.";
    const interactive = !!next && !this.playing && !this.busy;
    this.view.setMode("play");
    this.view.setMoves(interactive ? [next] : []);
    this.view.setHint(interactive ? next : null);
    this.view.events = interactive ? { onMove: () => void this.step(1) } : {};
  }

  private setSpeed(s: number) {
    this.speed = s;
    storageSet("line-speed", String(s));
    [...this.speedSeg.children].forEach((b, i) => b.classList.toggle("on", SPEEDS[i].value === s));
  }

  async step(dir: 1 | -1, speed = this.speed) {
    if (this.busy || this.stopped) return;
    if (dir > 0 && this.index >= this.line.length) return;
    if (dir < 0 && this.index <= 0) return;
    this.busy = true;
    this.sync();
    if (dir > 0) await this.view.playMove(this.line[this.index++], speed);
    else await this.view.undoMove(this.line[--this.index], speed);
    this.busy = false;
    this.sync();
  }

  async seek(target: number) {
    this.pause();
    while (!this.stopped && this.index !== target) await this.step(target > this.index ? 1 : -1, Math.max(4, this.speed));
  }

  async play() {
    if (this.playing || this.stopped) return;
    if (this.index >= this.line.length) await this.seek(0);
    this.playing = true;
    this.sync();
    while (this.playing && !this.stopped && this.index < this.line.length) {
      await this.step(1);
      if (this.playing) await new Promise((r) => setTimeout(r, PAUSE_MS / this.speed));
    }
    this.playing = false;
    this.sync();
  }

  pause() {
    this.playing = false;
    this.sync();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  private onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight") void this.step(1);
    else if (e.key === "ArrowLeft") void this.step(-1);
    // A focused button already reacts to space with its own click.
    else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) this.toggle();
    else return;
    e.preventDefault();
  }

  stop() {
    this.stopped = true;
    this.playing = false;
    window.removeEventListener("keydown", this.keyHandler);
    this.view.setHint(null);
    this.view.setMoves([]);
    this.view.events = {};
  }
}
