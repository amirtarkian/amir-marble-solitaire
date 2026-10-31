import "./styles.css";
import type { App, Screen } from "./app";
import { Coach } from "./coach/client";
import { easyMoves, holeSolution, loadSolutions } from "./data/solutions";
import { sounds } from "./render/audio";
import { BoardView } from "./render/scene";
import { parseLabel } from "./board/geometry";
import { ExplorerScreen } from "./ui/explorer";
import { LearnScreen } from "./ui/learn";
import { PlayScreen } from "./ui/play";
import { RaceScreen } from "./ui/race";

async function boot() {
  const stage = document.getElementById("stage")!;
  const panel = document.getElementById("panel")!;
  const view = new BoardView(stage);
  document.getElementById("loading")?.remove();
  const [coach, solutions] = await Promise.all([Coach.create(), loadSolutions()]);
  const app: App = { view, coach, solutions, panel };
  if (import.meta.env.DEV) Object.assign(window, { __app: app });

  let screen: Screen | null = null;
  const route = () => {
    const [, name = "play", arg, arg2] = location.hash.split("/");
    screen?.unmount();
    document.querySelectorAll<HTMLAnchorElement>("nav a").forEach((a) => a.classList.toggle("on", a.dataset.route === name));
    panel.scrollTop = 0; // before the screen renders, so it can scroll somewhere itself
    const start = (name === "play" || name === "practice") && arg ? parseLabel(arg) : null;
    const practiceFrom = name === "practice" ? Number(arg2) || 0 : 0;
    const hole = start !== null && solutions ? holeSolution(solutions, start) : undefined;
    screen =
      name === "solutions" ? new ExplorerScreen(app)
      : name === "learn" ? new LearnScreen(app, arg)
      : name === "race" ? new RaceScreen(app, arg)
      : start === null ? new PlayScreen(app)
      : practiceFrom && hole
        ? new PlayScreen(app, { start, moves: easyMoves(hole).slice(0, practiceFrom), practiceFrom })
        : new PlayScreen(app, { start, moves: [] });
  };
  window.addEventListener("hashchange", route);
  route();

  const mute = document.getElementById("mute")!;
  mute.onclick = () => {
    sounds.setMuted(!sounds.muted);
    mute.textContent = sounds.muted ? "🔇" : "🔊";
  };
}

void boot();
