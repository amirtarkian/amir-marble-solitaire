// A small SVG board for watching other racers.

import { HOLES, rc } from "../board/geometry";
import { Game, makeMove, type WireMove } from "../game/state";

const NS = "http://www.w3.org/2000/svg";

export function miniBoard(start: number, moves: WireMove[], size = 92): SVGSVGElement {
  let board: Uint8Array;
  try {
    board = Game.replay(start, moves.map(([f, t]) => makeMove(f, t))).board;
  } catch {
    board = new Game(start).board;
  }
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "-0.6 -0.6 8.2 8.2");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.classList.add("mini");
  const disc = document.createElementNS(NS, "circle");
  Object.entries({ cx: 3.5, cy: 3.5, r: 4.1, class: "mini-board" }).forEach(([k, v]) => disc.setAttribute(k, String(v)));
  svg.append(disc);
  for (const h of HOLES) {
    const [r, c] = rc(h);
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", String(c + 0.5));
    dot.setAttribute("cy", String(r + 0.5));
    dot.setAttribute("r", board[h] ? "0.38" : "0.16");
    dot.setAttribute("class", board[h] ? "mini-marble" : "mini-hole");
    svg.append(dot);
  }
  return svg;
}
