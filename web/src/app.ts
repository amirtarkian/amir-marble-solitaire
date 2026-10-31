import type { Coach } from "./coach/client";
import type { Solutions } from "./data/solutions";
import type { BoardView } from "./render/scene";

/** Everything a screen needs from the shell. */
export interface App {
  view: BoardView;
  coach: Coach | null;
  solutions: Solutions | null;
  /** The side panel (bottom sheet on phones) a screen renders into. */
  panel: HTMLElement;
}

export interface Screen {
  unmount(): void;
}

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: preferences just don't persist */
  }
}
