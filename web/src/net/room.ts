// Peer-to-peer room over WebRTC (Trystero, signalling through public Nostr relays).
// No server: friends who open the same room link find each other directly.

import { joinRoom, pauseRelayReconnection, resumeRelayReconnection, selfId } from "trystero";
import type { RaceEvent, RaceMessage } from "./race";

const APP_ID = "amir-marble-solitaire-v1";

export class RaceRoom {
  readonly selfId = selfId;
  private room: ReturnType<typeof joinRoom>;
  private action: { send: (data: RaceMessage, opts?: { target?: string }) => Promise<void> };

  constructor(roomId: string, handlers: { onEvent: (ev: RaceEvent) => void; onPeerJoin: (id: string) => void }) {
    resumeRelayReconnection();
    this.room = joinRoom({ appId: APP_ID }, roomId);
    const action = this.room.makeAction<RaceMessage>("race");
    action.onMessage = (data, ctx) => handlers.onEvent({ ...data, from: ctx.peerId } as RaceEvent);
    this.action = action as unknown as RaceRoom["action"];
    this.room.onPeerJoin = (id) => handlers.onPeerJoin(id);
    this.room.onPeerLeave = (id) => handlers.onEvent({ type: "leave", from: id });
  }

  send(msg: RaceMessage, target?: string) {
    void this.action.send(msg, target ? { target } : undefined).catch(() => {});
  }

  peerCount(): number {
    return Object.keys(this.room.getPeers()).length;
  }

  leave() {
    void this.room.leave();
    // Stop retrying relays (some public ones are always down) until the next room.
    pauseRelayReconnection();
  }
}
