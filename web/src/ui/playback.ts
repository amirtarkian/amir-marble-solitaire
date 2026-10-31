// Plays a line of moves on the board with ⏮ ◀ ⏯ ▶ ⏭ controls. Used by "Show me", the
// review's "Show best line" and the solutions explorer.

import type { Move } from "../game/state";
import type { BoardView } from "../render/scene";
import { h } from "./dom";

export class LinePlayer {
  readonly el: HTMLElement;
  private index = 0;
  private playing = false;
  private busy = false;
  private stopped = false;
  private counter: HTMLElement;
  private playBtn: HTMLButtonElement;

  /** The view must already show the position the line starts from. */
  constructor(
    private view: BoardView,
    private line: Move[],
    private opts: { onStep?: (index: number) => void; speed?: number; caption?: (i: number) => string } = {},
  ) {
    this.counter = h("span.counter");
    this.playBtn = h("button.icon", { title: "Play / pause", onclick: () => this.toggle() }, "▶");
    this.el = h("div.player",
      {},
      h("button.icon", { title: "Back to start", onclick: () => this.seek(0) }, "⏮"),
      h("button.icon", { title: "Step back", onclick: () => this.step(-1) }, "‹"),
      this.playBtn,
      h("button.icon", { title: "Step forward", onclick: () => this.step(1) }, "›"),
      h("button.icon", { title: "To the end", onclick: () => this.seek(this.line.length) }, "⏭"),
      this.counter,
    );
    this.view.setMoves([]);
    this.render();
  }

  get position(): number {
    return this.index;
  }

  get moves(): Move[] {
    return this.line.slice(0, this.index);
  }

  private render() {
    this.counter.textContent = this.opts.caption?.(this.index) ?? `${this.index} / ${this.line.length}`;
    this.playBtn.textContent = this.playing ? "❚❚" : "▶";
    this.opts.onStep?.(this.index);
  }

  async step(dir: 1 | -1, speed = this.opts.speed ?? 1) {
    if (this.busy || this.stopped) return;
    if (dir > 0 && this.index >= this.line.length) return;
    if (dir < 0 && this.index <= 0) return;
    this.busy = true;
    if (dir > 0) await this.view.playMove(this.line[this.index++], speed);
    else await this.view.undoMove(this.line[--this.index], speed);
    this.busy = false;
    this.render();
  }

  async seek(target: number) {
    this.pause();
    while (!this.stopped && this.index !== target) await this.step(target > this.index ? 1 : -1, 4);
  }

  async play() {
    if (this.playing) return;
    if (this.index >= this.line.length) await this.seek(0);
    this.playing = true;
    this.render();
    while (this.playing && !this.stopped && this.index < this.line.length) {
      await this.step(1);
      await new Promise((r) => setTimeout(r, 380));
    }
    this.playing = false;
    if (!this.stopped) this.render();
  }

  pause() {
    this.playing = false;
    this.render();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  stop() {
    this.stopped = true;
    this.playing = false;
  }
}
