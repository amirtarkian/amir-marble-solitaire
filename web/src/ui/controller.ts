// Binds a Game to the BoardView: gestures become moves, and undo/redo animate.
// Shared by solo play and race rooms.

import type { Cell } from "../board/geometry";
import { Game, type Move } from "../game/state";
import type { BoardView } from "../render/scene";

export type ChangeKind = "move" | "undo" | "redo";

export class GameController {
  readonly game: Game;
  onChange?: (kind: ChangeKind, m: Move) => void;
  private queue: Promise<void> = Promise.resolve();
  private active = true;

  constructor(private view: BoardView, start: Cell, moves: readonly Move[] = []) {
    this.game = Game.replay(start, moves);
    view.setMode("play");
    view.setBoard(this.game.board);
    view.setMoves(this.game.legalMoves());
    view.events = { onMove: (m) => void this.play(m) };
  }

  /** Run animations one after another, so fast clicks never interleave. */
  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(fn, fn);
    return this.queue;
  }

  play(m: Move): Promise<void> {
    return this.enqueue(async () => {
      if (!this.active || !this.game.isLegal(m)) return;
      this.game.play(m);
      this.view.setMoves([]);
      this.view.setHint(null);
      this.onChange?.("move", m);
      await this.view.playMove(m);
      if (this.active) this.view.setMoves(this.game.legalMoves());
    });
  }

  undo(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.active) return;
      const m = this.game.undo();
      if (!m) return;
      this.view.setMoves([]);
      this.view.setHint(null);
      this.onChange?.("undo", m);
      await this.view.undoMove(m);
      if (this.active) this.view.setMoves(this.game.legalMoves());
    });
  }

  redo(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.active) return;
      const m = this.game.redo();
      if (!m) return;
      this.view.setMoves([]);
      this.onChange?.("redo", m);
      await this.view.playMove(m);
      if (this.active) this.view.setMoves(this.game.legalMoves());
    });
  }

  /** Waits for queued animations to finish. */
  settle(): Promise<void> {
    return this.queue;
  }

  /** Stop reacting to the board (the screen is leaving or showing a preview). */
  detach() {
    this.active = false;
    this.view.events = {};
    this.view.setMoves([]);
  }

  resume() {
    this.active = true;
    this.view.setMode("play");
    this.view.setBoard(this.game.board);
    this.view.setMoves(this.game.legalMoves());
    this.view.events = { onMove: (m) => void this.play(m) };
  }
}
