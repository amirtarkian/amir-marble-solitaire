// Race rooms: everyone plays the same starting hole at the same time. Fewest marbles
// wins; ties go to the faster finish. The coach stays out of it until the review.

import { type App, type Screen, storageGet, storageSet } from "../app";
import { HOLES, label } from "../board/geometry";
import { startBoard, toWire } from "../game/state";
import type { RaceRoom } from "../net/room";
import { type Player, type RaceEvent, type RaceMessage, type RaceState, hostId, initialState, isHost, marblesLeft, reduce, standings } from "../net/race";
import { GameController } from "./controller";
import { clear, formatTime, h, plural } from "./dom";
import { miniBoard } from "./miniboard";
import { ReviewScreen } from "./review";

const COUNTDOWN_MS = 3500;

function defaultName(): string {
  const saved = storageGet("player-name");
  if (saved) return saved;
  const name = `Player ${Math.floor(100 + Math.random() * 900)}`;
  storageSet("player-name", name);
  return name;
}

const newRoomId = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

export class RaceScreen implements Screen {
  private room: RaceRoom | null = null;
  private state: RaceState | null = null;
  private ctl: GameController | null = null;
  private ctlRound = 0;
  private name = defaultName();
  private ticker = 0;
  private countdownEl: HTMLElement | null = null;
  private review: ReviewScreen | null = null;
  private renderedPhase = "";
  private closed = false;

  constructor(private app: App, private roomId?: string) {
    if (!roomId) this.landing();
    else void this.join(roomId);
  }

  unmount() {
    this.closed = true;
    clearInterval(this.ticker);
    this.countdownEl?.remove();
    this.review?.unmount();
    this.ctl?.detach();
    this.room?.leave();
    this.app.view.setHeat(null);
  }

  private landing() {
    const { panel, view } = this.app;
    view.setMode("view");
    view.setBoard(startBoard(18));
    const nameInput = h("input.text", { value: this.name, maxlength: 24, placeholder: "Your name" });
    clear(panel);
    panel.append(h("section.card",
      {},
      h("h2", {}, "Race your friends"),
      h("p", {}, "Create a room and send the link. Everyone gets the same starting hole and plays at the same time; you'll see each other's boards live. Fewest marbles wins, and the faster finish breaks ties."),
      h("label.field", {}, "Your name", nameInput),
      h("div.row", {}, h("button.primary", {
        onclick: () => {
          this.setName(nameInput.value);
          location.hash = `#/race/${newRoomId()}`;
        },
      }, "Create a room")),
      h("p.muted", {}, "Rooms are peer-to-peer: no accounts, nothing stored on a server."),
    ));
  }

  private setName(name: string) {
    this.name = name.trim().slice(0, 24) || this.name;
    storageSet("player-name", this.name);
  }

  // ── Networking ───────────────────────────────────────────────────────

  private async join(roomId: string) {
    const { panel } = this.app;
    clear(panel);
    panel.append(h("section.card", {}, h("h2", {}, "Joining room…"), h("p.muted", {}, roomId)));
    const { RaceRoom } = await import("../net/room");
    if (this.closed) return;
    const room = new RaceRoom(roomId, {
      onEvent: (ev) => this.dispatch(ev),
      onPeerJoin: (id) => this.greet(id),
    });
    this.room = room;
    this.state = initialState(room.selfId, this.name, Date.now());
    this.ticker = window.setInterval(() => this.tick(), 250);
    this.render();
  }

  private hello(): RaceMessage {
    const me = this.state!.players[this.state!.selfId];
    return { type: "hello", name: this.name, joinedAt: me.joinedAt, round: me.round, moves: me.moves, finished: me.finished };
  }

  /** A peer connected: introduce ourselves, and if we host, bring them up to date. */
  private greet(peer: string) {
    const s = this.state!;
    this.room!.send(this.hello(), peer);
    if (!isHost(s)) return;
    this.room!.send({ type: "config", startHole: s.startHole }, peer);
    if (s.phase !== "lobby" && s.startAt) this.room!.send({ type: "start", startHole: s.startHole, at: s.startAt, round: s.round }, peer);
    this.render();
  }

  /** Apply a message locally and send it to everyone. */
  private broadcast(msg: RaceMessage) {
    this.room!.send(msg);
    this.dispatch({ ...msg, from: this.state!.selfId } as RaceEvent);
  }

  private dispatch(ev: RaceEvent) {
    const before = this.state!;
    this.state = reduce(before, ev);
    if (this.state.phase === "racing" && this.state.round !== this.ctlRound) this.beginRound();
    if (ev.type === "config" && this.state.phase === "lobby") this.app.view.setBoard(startBoard(this.state.startHole));
    this.render();
  }

  // ── Racing ───────────────────────────────────────────────────────────

  private beginRound() {
    const s = this.state!;
    this.ctl?.detach();
    this.review?.unmount();
    this.review = null;
    this.ctlRound = s.round;
    this.app.view.setHeat(null);
    this.app.view.setMode("view");
    this.app.view.setBoard(startBoard(s.startHole));
    this.ctl = null;
    const wait = Math.max(0, (s.startAt ?? Date.now()) - Date.now());
    this.showCountdown();
    window.setTimeout(() => {
      if (this.state?.round !== s.round) return;
      this.countdownEl?.remove();
      this.countdownEl = null;
      const ctl = new GameController(this.app.view, s.startHole);
      ctl.onChange = (kind, m) => {
        const round = this.state!.round;
        if (kind === "undo") this.broadcast({ type: "undo", round });
        else this.broadcast({ type: "move", round, move: toWire(m) });
        void ctl.settle().then(() => {
          if (ctl.game.isOver && !this.me()?.finished && this.state?.round === round) {
            this.broadcast({ type: "finish", round, marbles: ctl.game.marbles, ms: Date.now() - (this.state!.startAt ?? Date.now()) });
          }
        });
      };
      this.ctl = ctl;
      this.render();
    }, wait);
  }

  private showCountdown() {
    this.countdownEl?.remove();
    this.countdownEl = h("div.countdown");
    document.body.append(this.countdownEl);
    this.tick();
  }

  private tick() {
    const s = this.state;
    if (!s) return;
    if (this.countdownEl && s.startAt) {
      const left = s.startAt - Date.now();
      this.countdownEl.textContent = left > 500 ? String(Math.ceil((left - 500) / 1000)) : "Go!";
    }
    const t = document.getElementById("race-time");
    if (t && s.startAt) {
      const mine = this.me()?.finished;
      t.textContent = formatTime(mine ? mine.ms : Math.max(0, Date.now() - s.startAt));
    }
  }

  private me(): Player | undefined {
    return this.state ? this.state.players[this.state.selfId] : undefined;
  }

  // ── Panels ───────────────────────────────────────────────────────────

  private render() {
    const s = this.state;
    if (!s || this.review) return;
    if (s.phase === "lobby") this.renderLobby();
    else if (s.phase === "racing") this.renderRacing();
    else this.renderResults();
    this.renderedPhase = s.phase;
  }

  private shareCard(): HTMLElement {
    const url = location.href;
    const copy = h("button", {
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(url);
          copy.textContent = "Copied!";
        } catch {
          (link as HTMLInputElement).select();
        }
      },
    }, "Copy link");
    const link = h("input.text", { value: url, readonly: true, onclick: (e: Event) => (e.target as HTMLInputElement).select() });
    return h("div.share", {}, link, copy);
  }

  private renderLobby() {
    const s = this.state!, { view, panel } = this.app;
    const host = isHost(s);
    this.ctl?.detach();
    this.ctl = null;
    view.setMode(host ? "pick" : "view");
    if (this.renderedPhase !== "lobby") view.setBoard(startBoard(s.startHole));
    view.events = host ? {
      onHoleClick: (cell) => this.broadcast({ type: "config", startHole: cell }),
    } : {};
    view.setHeat([{ cell: s.startHole, color: "#f2c14e", text: "★" }]);
    const players = Object.values(s.players).sort((a, b) => a.joinedAt - b.joinedAt);
    const nameInput = h("input.text", {
      value: this.name, maxlength: 24,
      onchange: () => {
        this.setName(nameInput.value);
        this.broadcast(this.hello());
      },
    });
    const peers = players.length - 1;
    clear(panel);
    panel.append(
      h("section.card",
        {},
        h("div.card-head", {}, h("h2", {}, "Race room"), h("span.pill", {}, this.roomId!)),
        h("p.muted", {}, peers ? `${plural(peers, "friend")} connected.` : "Waiting for friends. Send them this link:"),
        this.shareCard(),
        h("label.field", {}, "Your name", nameInput),
      ),
      h("section.card",
        {},
        h("h3", {}, "Players"),
        h("ul.players", {}, ...players.map((p) => h("li", {},
          h("span.name", {}, p.name), p.id === s.selfId ? h("span.tag", {}, "you") : null, p.id === hostId(s) ? h("span.tag.gold", {}, "host") : null))),
      ),
      h("section.card",
        {},
        h("h3", {}, `Starting hole: ${label(s.startHole)}`),
        host
          ? h("div", {},
              h("p.muted", {}, "Tap any marble on the board to make it the starting hole."),
              h("div.row",
                {},
                h("button", { onclick: () => this.broadcast({ type: "config", startHole: HOLES[Math.floor(Math.random() * HOLES.length)] }) }, "Random"),
                h("button.primary", { onclick: () => this.broadcast({ type: "start", startHole: s.startHole, at: Date.now() + COUNTDOWN_MS, round: s.round + 1 }) }, "Start race"),
              ))
          : h("p.muted", {}, `Waiting for ${s.players[hostId(s)].name} to start the race…`),
      ),
    );
  }

  private standingsList(): HTMLElement {
    const s = this.state!;
    const list = h("ol.standings");
    for (const p of standings(s)) {
      const status = p.desynced ? "out of sync" : p.finished ? `${plural(p.finished.marbles, "marble")} · ${formatTime(p.finished.ms)}` : `${marblesLeft(p)} left`;
      list.append(h("li", { class: p.id === s.selfId ? "me" : "" },
        p.id === s.selfId ? null : miniBoard(s.startHole, p.moves, 64),
        h("div.who", {}, h("span.name", {}, p.name + (p.id === s.selfId ? " (you)" : "")), h("span.muted", {}, status)),
        p.finished ? h("span.tag.gold", {}, "done") : null,
      ));
    }
    return list;
  }

  private renderRacing() {
    const s = this.state!, { panel } = this.app;
    const me = this.me();
    clear(panel);
    panel.append(
      h("section.card",
        {},
        h("div.card-head", {}, h("h2", {}, `Racing from ${label(s.startHole)}`), h("span.pill", { id: "race-time" }, "0:00")),
        me?.finished
          ? h("p", {}, `You finished with ${plural(me.finished.marbles, "marble")}. Waiting for the others…`)
          : h("div.row",
              {},
              h("span.stat-inline", {}, `${me ? marblesLeft(me) : 36} marbles left`),
              h("span.spacer"),
              h("button", { onclick: () => void this.ctl?.undo(), disabled: !this.ctl?.game.canUndo }, "↶ Undo"),
            ),
      ),
      h("section.card", {}, h("h3", {}, "Standings"), this.standingsList()),
    );
    this.tick();
  }

  private renderResults() {
    const s = this.state!, { panel } = this.app;
    const ranked = standings(s);
    const winner = ranked[0];
    clear(panel);
    panel.append(
      h("section.card.end",
        {},
        h("div.big", {}, winner?.id === s.selfId ? "🏆" : "🏁"),
        h("h2", {}, winner ? `${winner.id === s.selfId ? "You win" : `${winner.name} wins`}${winner.finished ? ` with ${plural(winner.finished.marbles, "marble")}` : ""}!` : "Race over"),
        this.standingsList(),
        h("div.row",
          {},
          this.ctl ? h("button.primary", { onclick: () => this.openReview() }, "Review my game") : null,
          isHost(s) ? h("button", { onclick: () => this.broadcast({ type: "lobby" }) }, "Next round") : h("span.muted", {}, "The host can start the next round."),
        ),
      ),
    );
  }

  private openReview() {
    const ctl = this.ctl;
    if (!ctl) return;
    ctl.detach();
    const r = new ReviewScreen(this.app, ctl.game.start, [...ctl.game.history], {
      onPlayFrom: () => close(),
      onClose: () => close(),
    });
    this.review = r;
    const close = () => {
      r.unmount();
      this.review = null;
      this.app.view.setBoard(ctl.game.board);
      this.render();
    };
  }
}
