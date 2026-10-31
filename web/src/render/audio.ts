// Synthesised sounds: stone landing in a wooden dimple, and a softer roll into the groove.

let ctx: AudioContext | null = null;
let muted = false;

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function knock(freq: number, q: number, gain: number, decay: number, ping = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const len = Math.floor(a.sampleRate * decay * 2);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (a.sampleRate * decay * 0.25));
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
  if (ping) {
    const o = a.createOscillator();
    o.frequency.value = ping;
    const pg = a.createGain();
    pg.gain.setValueAtTime(gain * 0.12, t);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.6);
    o.connect(pg).connect(a.destination);
    o.start(t);
    o.stop(t + decay);
  }
}

export const sounds = {
  land: () => knock(1900, 1.2, 0.9, 0.09, 2600),
  pick: () => knock(3200, 2, 0.25, 0.04),
  groove: () => knock(700, 0.9, 0.6, 0.16),
  setMuted(m: boolean) {
    muted = m;
  },
  get muted() {
    return muted;
  },
};
