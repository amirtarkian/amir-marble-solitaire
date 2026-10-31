// A tiny tween scheduler on a virtual clock. The render loop advances the clock, so
// animations also run when frames are sparse, and tests can step time by hand.

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOut = (t: number) => 1 - (1 - t) ** 3;

interface Tween {
  start: number;
  duration: number;
  update: (k: number) => void;
  resolve: () => void;
}

export class Tweens {
  private now = 0;
  private list: Tween[] = [];

  /** Calls `update(k)` with k going 0 → 1 over `duration` ms, after `delay` ms. */
  add(duration: number, update: (k: number) => void, delay = 0): Promise<void> {
    return new Promise((resolve) => {
      this.list.push({ start: this.now + delay, duration: Math.max(1, duration), update, resolve });
    });
  }

  get busy(): boolean {
    return this.list.length > 0;
  }

  step(dtMs: number) {
    this.now += dtMs;
    const done: Tween[] = [];
    for (const t of this.list) {
      if (this.now < t.start) continue;
      const k = Math.min(1, (this.now - t.start) / t.duration);
      t.update(k);
      if (k >= 1) done.push(t);
    }
    if (done.length) {
      this.list = this.list.filter((t) => !done.includes(t));
      for (const t of done) t.resolve();
    }
  }

  /** Jump every running tween to its end. */
  finishAll() {
    this.step(1e9);
  }
}
