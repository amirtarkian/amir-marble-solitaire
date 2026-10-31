// The review graph. Top: odds of finishing with 1, 2, 3 or 4+ marbles after every move,
// for a player of a given skill, along the road this game actually took. Middle: one bar
// per move, as tall as the share of moves that would have thrown marbles away (how hard
// the position was), coloured by what you played. Bottom: the solver's exact best
// possible finish. Hover for details; click to jump the board to that move.

import { label } from "../board/geometry";
import type { Move } from "../game/state";
import { KIND_COLOR, KIND_LABEL, type MoveKind } from "../review/grade";
import { h, plural } from "./dom";

const NS = "http://www.w3.org/2000/svg";
const W = 340, L = 30, R = 332, T = 10, B = 132;
const BAR_B = 168, BAR_H = 28, STRIP_T = 176, STRIP_B = 190, H = 210;
export const SERIES = [
  { name: "1 marble", color: "#f2c14e" },
  { name: "2", color: "#5fb3a1" },
  { name: "3", color: "#e8955a" },
  { name: "4+", color: "#8a8f98" },
];

type P4 = [number, number, number, number];

export interface ChartData {
  moves: Move[];
  /** Best possible finish after i moves (null while still being worked out). */
  values: (number | null)[];
  odds: (P4 | null)[];
  /** Per move: good and total moves at the position it was played from (0 = unknown). */
  good: number[];
  total: number[];
  kinds: (MoveKind | null)[];
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

  constructor(private n: number, private onSelect: (i: number) => void) {
    this.root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "odds-chart", role: "img", "aria-label": "How the game went, move by move" });
    this.el = h("div.chart", {}, this.root, this.tip, this.legend);
    this.root.addEventListener("pointermove", (e) => this.setHover(this.indexAt(e)));
    this.root.addEventListener("pointerleave", () => this.setHover(null));
    this.root.addEventListener("click", (e) => {
      const i = this.indexAt(e);
      if (i !== null) this.onSelect(i);
    });
  }

  private x(i: number) {
    return L + ((R - L) * i) / Math.max(1, this.n);
  }

  private y(p: number) {
    return B - (B - T) * p;
  }

  private indexAt(e: PointerEvent | MouseEvent): number | null {
    const r = this.root.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    if (px < L - 10 || px > R + 10) return null;
    return Math.min(this.n, Math.max(0, Math.round(((px - L) / (R - L)) * this.n)));
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
    const d = this.data, g = this.root;
    while (g.firstChild) g.firstChild.remove();
    if (!d) return;
    const cell = (R - L) / Math.max(1, this.n);

    for (const p of [0, 0.5, 1]) {
      svg("line", { x1: L, x2: R, y1: this.y(p), y2: this.y(p), class: "grid" }, g);
      svg("text", { x: L - 5, y: this.y(p) + 3, class: "axis", "text-anchor": "end" }, g).textContent = `${p * 100}%`;
    }
    const step = this.n > 24 ? 10 : 5;
    for (let i = 0; i <= this.n; i += step) {
      svg("text", { x: this.x(i), y: H - 4, class: "axis", "text-anchor": "middle" }, g).textContent = String(i);
    }

    // Difficulty bars, one per move, drawn between the positions it connects.
    svg("text", { x: L - 5, y: BAR_B - 2, class: "axis", "text-anchor": "end" }, g).textContent = "hard";
    svg("line", { x1: L, x2: R, y1: BAR_B, y2: BAR_B, class: "grid" }, g);
    d.moves.forEach((_, j) => {
      const total = d.total[j], kind = d.kinds[j];
      if (!total || !kind) return;
      const traps = 1 - d.good[j] / total;
      const hgt = Math.max(2, BAR_H * traps);
      svg("rect", { x: this.x(j + 0.5) - cell * 0.38, width: cell * 0.76, y: BAR_B - hgt, height: hgt, rx: 1, fill: KIND_COLOR[kind] }, g);
    });

    // Exact best possible finish.
    svg("text", { x: L - 5, y: STRIP_B - 3, class: "axis", "text-anchor": "end" }, g).textContent = "best";
    d.values.forEach((v, i) => {
      if (v === null) return;
      const x0 = Math.max(L, this.x(i) - cell / 2), x1 = Math.min(R, this.x(i) + cell / 2);
      svg("rect", { x: x0, width: x1 - x0, y: STRIP_T, height: STRIP_B - STRIP_T, fill: SERIES[Math.min(v, 4) - 1].color, opacity: 0.85 }, g);
    });

    // Where marbles were thrown away.
    for (let i = 1; i <= this.n; i++) {
      const a = d.values[i - 1], b = d.values[i];
      if (a === null || b === null || b <= a) continue;
      svg("line", { x1: this.x(i), x2: this.x(i), y1: T, y2: STRIP_B, class: "blunder-line" }, g);
      svg("circle", { cx: this.x(i), cy: (STRIP_T + STRIP_B) / 2, r: 5.5, class: b - a > 1 ? "blunder major" : "blunder minor" }, g);
    }

    // Odds lines; the chance of a one-marble finish is shaded.
    const pts: [number, number][][] = [[], [], [], []];
    d.odds.forEach((o, i) => o?.forEach((p, k) => pts[k].push([this.x(i), this.y(p)])));
    if (pts[0].length > 1) {
      const area = `M${pts[0][0][0]},${B} ` + pts[0].map(([x, y]) => `L${x},${y}`).join(" ") + ` L${pts[0][pts[0].length - 1][0]},${B} Z`;
      svg("path", { d: area, fill: SERIES[0].color, opacity: 0.12 }, g);
    }
    pts.forEach((line, k) => {
      if (line.length > 1) svg("polyline", { points: line.map(([x, y]) => `${x},${y}`).join(" "), stroke: SERIES[k].color, class: "series" }, g);
    });
    if (!pts[0].length) {
      svg("text", { x: (L + R) / 2, y: (T + B) / 2, class: "axis pending", "text-anchor": "middle" }, g).textContent = "Measuring how hard each position was…";
    }

    const cursor = (i: number, cls: string) => {
      svg("line", { x1: this.x(i), x2: this.x(i), y1: T, y2: STRIP_B, class: cls }, g);
      d.odds[i]?.forEach((p, k) => svg("circle", { cx: this.x(i), cy: this.y(p), r: 3, fill: SERIES[k].color }, g));
    };
    cursor(d.selected, "cursor");
    if (this.hover !== null && this.hover !== d.selected) cursor(this.hover, "cursor hover");
    this.drawTip();
    this.drawLegend();
  }

  private drawTip() {
    const i = this.hover, tip = this.tip, d = this.data;
    if (i === null || !d) {
      tip.style.display = "none";
      return;
    }
    while (tip.firstChild) tip.firstChild.remove();
    const m = d.moves[i - 1];
    tip.append(h("div.tip-title", {}, i === 0 ? "Start" : `Move ${i}: ${label(m.from)} → ${label(m.to)}`));
    const j = i - 1, kind = d.kinds[j];
    if (i > 0 && d.total[j]) {
      tip.append(h("div.tip-best", {}, `${d.good[j]} of ${plural(d.total[j], "move")} kept the best`, kind ? h("span", { style: `color:${KIND_COLOR[kind]}` }, ` · ${KIND_LABEL[kind]}`) : ""));
    }
    const v = d.values[i];
    if (v !== null) tip.append(h("div.tip-best", {}, `Best possible after: ${plural(v, "marble")}`));
    const o = d.odds[i];
    if (o) SERIES.forEach((s, k) => tip.append(h("div.tip-row", {}, h("span.dot", { style: `background:${s.color}` }), ` ${s.name}`, h("span.tip-val", {}, `${Math.round(o[k] * 100)}%`))));
    tip.style.display = "block";
    const onRight = this.x(i) < (L + R) / 2;
    tip.style.left = onRight ? "" : "34px";
    tip.style.right = onRight ? "6px" : "";
  }

  private drawLegend() {
    const d = this.data!, o = d.odds[d.selected];
    const leg = this.legend;
    while (leg.firstChild) leg.firstChild.remove();
    leg.append(h("span.legend-title", {}, d.selected === 0 ? "Start:" : `After move ${d.selected}:`));
    SERIES.forEach((s, k) => leg.append(h("span.legend-item", {}, h("span.dot", { style: `background:${s.color}` }), ` ${s.name} `, h("strong", {}, o ? `${Math.round(o[k] * 100)}%` : "…"))));
  }
}
