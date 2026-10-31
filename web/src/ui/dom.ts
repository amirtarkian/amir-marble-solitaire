// Minimal DOM helpers: h("button.primary", { onclick }, "Text").

type Child = Node | string | number | null | undefined | false;
type Props = Partial<Record<string, unknown>> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split(".");
  const el = document.createElement(tag) as HTMLElementTagNameMap[K];
  if (classes.length) el.className = classes.join(" ");
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = [el.className, v].filter(Boolean).join(" ");
    else if (k === "style") el.setAttribute("style", String(v));
    else if (k.startsWith("on")) (el as unknown as Record<string, unknown>)[k] = v;
    else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function clear(el: Element) {
  while (el.firstChild) el.firstChild.remove();
}

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Brief full-screen tint, e.g. red when a move throws away marbles. */
export function flash(kind: "warn" | "good") {
  const el = h("div.flash", { class: kind });
  document.body.append(el);
  el.addEventListener("animationend", () => el.remove());
}

export function toast(text: string, ms = 2600) {
  const el = h("div.toast", {}, text);
  document.body.append(el);
  setTimeout(() => el.classList.add("out"), ms);
  setTimeout(() => el.remove(), ms + 400);
}
