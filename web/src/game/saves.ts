// Saved solo games, kept in the browser (localStorage) so you can switch tabs, reload,
// or keep several games going at once.

import type { Cell } from "../board/geometry";
import type { WireMove } from "./state";

export interface SavedGame {
  id: string;
  start: Cell;
  moves: WireMove[];
  elapsed: number;
  updated: number;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const GAMES_KEY = "saved-games-v1";
const ACTIVE_KEY = "active-game-v1";
const MAX_GAMES = 12;

/** localStorage when it's usable; otherwise an in-memory stand-in (private mode, tests). */
function defaultStore(): KeyValueStore {
  try {
    localStorage.setItem("__probe", "1");
    localStorage.removeItem("__probe");
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
  }
}

export const newGameId = () => Math.random().toString(36).slice(2, 10);

export class Saves {
  constructor(private store: KeyValueStore = defaultStore()) {}

  /** Most recently played first. */
  list(): SavedGame[] {
    try {
      const raw = JSON.parse(this.store.getItem(GAMES_KEY) ?? "[]");
      return Array.isArray(raw) ? (raw as SavedGame[]).sort((a, b) => b.updated - a.updated) : [];
    } catch {
      return [];
    }
  }

  get(id: string): SavedGame | undefined {
    return this.list().find((g) => g.id === id);
  }

  put(game: SavedGame) {
    const games = [game, ...this.list().filter((g) => g.id !== game.id)].slice(0, MAX_GAMES);
    this.write(games);
  }

  remove(id: string) {
    this.write(this.list().filter((g) => g.id !== id));
    if (this.activeId() === id) this.setActive(null);
  }

  activeId(): string | null {
    return this.store.getItem(ACTIVE_KEY) || null;
  }

  setActive(id: string | null) {
    this.store.setItem(ACTIVE_KEY, id ?? "");
  }

  private write(games: SavedGame[]) {
    try {
      this.store.setItem(GAMES_KEY, JSON.stringify(games));
    } catch {
      /* storage full or blocked: progress just isn't kept */
    }
  }
}
