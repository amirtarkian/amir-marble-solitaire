import { describe, expect, test } from "bun:test";
import { type KeyValueStore, Saves } from "./saves";

const memory = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe("saved games", () => {
  test("put, list newest first, update in place, remove", () => {
    const s = new Saves(memory());
    s.put({ id: "a", start: 18, moves: [], elapsed: 0, updated: 1 });
    s.put({ id: "b", start: 17, moves: [[3, 17]], elapsed: 5, updated: 2 });
    expect(s.list().map((g) => g.id)).toEqual(["b", "a"]);
    s.put({ id: "a", start: 18, moves: [[4, 18]], elapsed: 9, updated: 3 });
    expect(s.list().map((g) => g.id)).toEqual(["a", "b"]);
    expect(s.get("a")!.moves).toEqual([[4, 18]]);
    s.remove("b");
    expect(s.list().length).toBe(1);
  });

  test("remembers the active game and forgets it when removed", () => {
    const s = new Saves(memory());
    s.put({ id: "a", start: 18, moves: [], elapsed: 0, updated: 1 });
    s.setActive("a");
    expect(s.activeId()).toBe("a");
    s.remove("a");
    expect(s.activeId()).toBeNull();
  });

  test("keeps at most 12 games", () => {
    const s = new Saves(memory());
    for (let i = 0; i < 20; i++) s.put({ id: `g${i}`, start: 18, moves: [], elapsed: 0, updated: i });
    expect(s.list().length).toBe(12);
    expect(s.list()[0].id).toBe("g19");
  });

  test("survives corrupt storage", () => {
    const store = memory();
    store.setItem("saved-games-v1", "{not json");
    expect(new Saves(store).list()).toEqual([]);
  });
});
