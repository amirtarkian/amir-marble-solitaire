// The review graph: odds of finishing with 1, 2, 3 or 4+ marbles after every move, a strip
// with the solver's exact best possible finish, and markers where marbles were thrown away.
// Hover for details; click to jump the board to that move.

import { finishOdds } from "../review/odds";
import { h, plural } from "./dom";

const NS = "http://www.w3.org/2000/svg";
const W = 340, L = 30, R = 332, T = 10, B = 150, STRIP_T = 160, STRIP_B = 176, H = 196;
export const SERIES = [
  { name: "1 marble", color: "#f2c14e" },
  { name: "2", color: "#5fb3a1" },
  { name: "3", color: "#e8955a" },
  { name: "4+", color: "#8a8f98" },
];

export interface ChartData {
  /** Best possible finish after i moves (null while still being worked out). */
  values: (number | null)[];
  /** Whether the last position is a finished game. */
  over: boolean;
  accuracy: number;
  selected: number;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.append(el);
  return el;
}

export class OddsChart {
  readonly el: HTMLElement;
  private root: SVGSVGElement;
  private tip = h("div.chart-tip");
  private legend = h("div.chart-legend");
  private data: ChartData | null = null;
  private hover: number | null = null;

  constructor(private moves: number, private onSelect: (i: number) => void) {
    this.root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "odds-chart", role: "img", "aria-label": "Odds of each finish after every move" });
    this.el = h("div.chart", {}, this.root, this.tip, this.legend);
    this.root.addEventListener("pointermove", (e) => this.setHover(this.indexAt(e)));
    this.root.addEventListener("pointerleave", () => this.setHover(null));
    this.root.addEventListener("click", (e) => {
      const i = this.indexAt(e);
      if (i !== null) this.onSelect(i);
    });
  }

  private x(i: number) {
    return L + ((R - L) * i) / Math.max(1, this.moves);
  }

  private y(p: number) {
    return B - (B - T) * p;
  }

  private indexAt(e: PointerEvent | MouseEvent): number | null {
    const r = this.root.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    if (px < L - 10 || px > R + 10) return null;
    return Math.min(this.moves, Math.max(0, Math.round(((px - L) / (R - L)) * this.moves)));
  }

  private odds(i: number) {
    const d = this.data!, v = d.values[i];
    if (v === null || v === undefined) return null;
    return finishOdds(v, 36 - i, d.accuracy, d.over && i === this.moves).p;
  }

  update(d: ChartData) {
    this.data = d;
    this.draw();
  }

  private setHover(i: number | null) {
    if (i === this.hover) return;
    this.hover = i;
    this.draw();
  }

  private draw() {
    const d = this.data;
    const g = this.root;
    while (g.firstChild) g.firstChild.remove();
    if (!d) return;

    // Grid and axes.
    for (const p of [0, 0.5, 1]) {
      svg("line", { x1: L, x2: R, y1: this.y(p), y2: this.y(p), class: "grid" }, g);
      svg("text", { x: L - 5, y: this.y(p) + 3, class: "axis", "text-anchor": "end" }, g).textContent = `${p * 100}%`;
    }
    const step = this.moves > 24 ? 10 : 5;
    for (let i = 0; i <= this.moves; i += step) {
      svg("text", { x: this.x(i), y: H - 4, class: "axis", "text-anchor": "middle" }, g).textContent = String(i);
    }

    // Exact best possible finish, one cell per position.
    svg("text", { x: L - 5, y: STRIP_B - 4, class: "axis", "text-anchor": "end" }, g).textContent = "best";
    const half = (R - L) / Math.max(1, this.moves) / 2;
    d.values.forEach((v, i) => {
      if (v === null) return;
      svg("rect", {
        x: Math.max(L, this.x(i) - half), width: Math.min(R, this.x(i) + half) - Math.max(L, this.x(i) - half),
        y: STRIP_T, height: STRIP_B - STRIP_T, fill: SERIES[Math.min(v, 4) - 1].color, opacity: 0.85,
      }, g);
    });

    // Where marbles were thrown away.
    for (let i = 1; i <= this.moves; i++) {
      const a = d.values[i - 1], b = d.values[i];
      if (a === null || b === null || b <= a) continue;
      svg("line", { x1: this.x(i), x2: this.x(i), y1: T, y2: STRIP_B, class: "blunder-line" }, g);
      svg("circle", { cx: this.x(i), cy: (STRIP_T + STRIP_B) / 2, r: 5.5, class: b - a > 1 ? "blunder major" : "blunder minor" }, g);
    }

    // Odds lines, with the chance of a one-marble finish shaded.
    const pts: [number, number][][] = [[], [], [], []];
    d.values.forEach((_, i) => {
      const o = this.odds(i);
      if (o) o.forEach((p, k) => pts[k].push([this.x(i), this.y(p)]));
    });
    if (pts[0].length > 1) {
      const area = `M${pts[0][0][0]},${B} ` + pts[0].map(([x, y]) => `L${x},${y}`).join(" ") + ` L${pts[0][pts[0].length - 1][0]},${B} Z`;
      svg("path", { d: area, fill: SERIES[0].color, opacity: 0.12 }, g);
    }
    pts.forEach((line, k) => {
      if (line.length < 2) return;
      svg("polyline", { points: line.map(([x, y]) => `${x},${y}`).join(" "), stroke: SERIES[k].color, class: "series" }, g);
    });

    // Cursors: the selected move (solid) and the hovered one (dashed).
    const cursor = (i: number, cls: string) => {
      svg("line", { x1: this.x(i), x2: this.x(i), y1: T, y2: STRIP_B, class: cls }, g);
      const o = this.odds(i);
      o?.forEach((p, k) => svg("circle", { cx: this.x(i), cy: this.y(p), r: 3, fill: SERIES[k].color }, g));
    };
    cursor(d.selected, "cursor");
    if (this.hover !== null && this.hover !== d.selected) cursor(this.hover, "cursor hover");

    this.drawTip();
    this.drawLegend();
  }

  private describe(i: number): string {
    return i === 0 ? "Start" : `After move ${i}`;
  }

  private drawTip() {
    const i = this.hover, tip = this.tip;
    if (i === null || !this.data) {
      tip.style.display = "none";
      return;
    }
    const o = this.odds(i), v = this.data.values[i];
    while (tip.firstChild) tip.firstChild.remove();
    tip.append(h("div.tip-title", {}, this.describe(i)));
    if (!o || v === null) tip.append(h("div", {}, "Grading…"));
    else {
      tip.append(h("div.tip-best", {}, `Best possible: ${plural(v, "marble")}`));
      SERIES.forEach((s, k) => tip.append(h("div.tip-row", {}, h("span.dot", { style: `background:${s.color}` }), ` ${s.name}`, h("span.tip-val", {}, `${Math.round(o[k] * 100)}%`))));
    }
    tip.style.display = "block";
    // Sit on the side of the graph away from the cursor, so the line stays visible.
    const onRight = this.x(i) < (L + R) / 2;
    tip.style.left = onRight ? "" : "34px";
    tip.style.right = onRight ? "6px" : "";
  }

  private drawLegend() {
    const d = this.data!, o = this.odds(d.selected);
    const leg = this.legend;
    while (leg.firstChild) leg.firstChild.remove();
    leg.append(h("span.legend-title", {}, `${this.describe(d.selected)}:`));
    SERIES.forEach((s, k) => leg.append(h("span.legend-item", {}, h("span.dot", { style: `background:${s.color}` }), ` ${s.name} `, h("strong", {}, o ? `${Math.round(o[k] * 100)}%` : "…"))));
  }
}
