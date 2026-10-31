// BoardView: the 3D board, its 37 marbles and every animation and gesture on it.
//
// The view never decides what is legal. The app tells it which moves are allowed
// (`setMoves`), the view reports gestures (`onMove`, `onHoleClick`), and the app answers
// by animating (`playMove`, `undoMove`) or syncing (`setBoard`).

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { type Cell, HOLES, holeXZ } from "../board/geometry";
import type { Move } from "../game/state";
import { Tweens, easeInOut } from "./anim";
import { sounds } from "./audio";
import { FIELD_Y, MARBLE_R, REST_Y, buildBoard, grooveSlot } from "./board-mesh";
import { stoneMaterials } from "./stones";

export type BoardMode = "play" | "pick" | "view";

export interface BoardEvents {
  /** Play mode: the player dragged or tapped out one of the allowed moves. */
  onMove?: (m: Move) => void;
  /** Pick and view modes: the player tapped a hole (or the marble in it). */
  onHoleClick?: (cell: Cell) => void;
}

export interface HeatCell {
  cell: Cell;
  color: string;
  text: string;
}

const TOTAL_MARBLES = 37;
const TAP_SLOP = 6; // px of movement before a press becomes a drag
const HOLE_PICK_RADIUS = 0.5;
const SELECT_GLOW = new THREE.Color("#ffb347");
const HINT_GLOW = new THREE.Color("#5dffa8");

interface Marble {
  mesh: THREE.Mesh;
  mat: THREE.MeshPhysicalMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
}

const holeVec = (cell: Cell, y = REST_Y) => {
  const { x, z } = holeXZ(cell);
  return new THREE.Vector3(x, y, z);
};

export class BoardView {
  events: BoardEvents = {};
  readonly tweens = new Tweens();

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private marbles: Marble[] = [];
  private at: (Marble | null)[] = new Array(49).fill(null);
  private groove: Marble[] = [];
  private rings = new Map<Cell, THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>();
  private labels = new Map<Cell, THREE.Sprite>();
  private ghosts: THREE.Mesh[] = [];
  private targetRings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
  private mode: BoardMode = "view";
  private moves: Move[] = [];
  private selected: Cell | null = null;
  private hovered: Cell | null = null;
  private hint: Move | null = null;
  private press: { cell: Cell | null; x: number; y: number; dragging: boolean; id: number } | null = null;
  private dragTarget: Cell | null = null;
  private lastTick = performance.now();
  private clock = 0;
  private disposed = false;
  private userMovedCamera = false;
  private moving = new Set<Marble>();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = "none";

    this.buildScene();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // Tuning borrowed from Pylos-Engine's camera controls.
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.addEventListener("start", () => (this.userMovedCamera = true));

    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.loop();
    if (import.meta.env.DEV) {
      // Lets automated checks advance animations when the tab gets no frames.
      (window as unknown as { __pump: (ms: number) => void }).__pump = (ms) => this.tick(ms);
    }
  }

  // ── Scene ────────────────────────────────────────────────────────────

  private buildScene() {
    const s = this.scene;
    s.background = new THREE.Color("#15100c");
    s.fog = new THREE.Fog("#15100c", 18, 38);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.55;

    s.add(new THREE.HemisphereLight("#fff1e0", "#2a1c12", 0.6));
    const key = new THREE.DirectionalLight("#ffe7c7", 2.4);
    key.position.set(5, 13, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    s.add(key);
    const rim = new THREE.DirectionalLight("#b8d4ff", 0.7);
    rim.position.set(-6, 5, -7);
    s.add(rim);

    const surface = new THREE.Mesh(
      new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({ color: "#211812", roughness: 0.92 }),
    );
    surface.rotation.x = -Math.PI / 2;
    surface.receiveShadow = true;
    s.add(surface);
    s.add(buildBoard());

    const ringGeo = new THREE.RingGeometry(MARBLE_R + 0.035, MARBLE_R + 0.1, 48);
    for (const h of HOLES) {
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(holeVec(h, FIELD_Y + 0.006));
      ring.visible = false;
      ring.renderOrder = 2;
      this.rings.set(h, ring);
      s.add(ring);
    }

    const sphere = new THREE.SphereGeometry(MARBLE_R, 48, 32);
    const ghostMat = new THREE.MeshBasicMaterial({ color: "#a8ffd8", transparent: true, opacity: 0.28, depthWrite: false });
    const targetGeo = new THREE.RingGeometry(MARBLE_R * 0.55, MARBLE_R + 0.09, 48);
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Mesh(sphere, ghostMat.clone());
      g.visible = false;
      this.ghosts.push(g);
      s.add(g);
      const ring = new THREE.Mesh(targetGeo, new THREE.MeshBasicMaterial({ color: "#7dffc0", transparent: true, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 3;
      this.targetRings.push(ring);
      s.add(ring);
    }

    const mats = stoneMaterials(TOTAL_MARBLES);
    for (let i = 0; i < TOTAL_MARBLES; i++) {
      const mat = mats[i].clone();
      const mesh = new THREE.Mesh(sphere, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.rotation.set(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3);
      const m: Marble = { mesh, mat, baseEmissive: mat.emissive.clone(), baseIntensity: mat.emissiveIntensity };
      mesh.userData.marble = m;
      this.marbles.push(m);
      s.add(mesh);
    }
    this.setBoard(Uint8Array.from({ length: 49 }, (_, i) => (HOLES.includes(i) ? 1 : 0)));
  }

  /** Frame the whole board from the default angle, for the current aspect ratio. */
  resetCamera() {
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const radius = 5.4; // board plus a margin
    const dist = Math.max((radius * 0.82) / Math.tan(vHalf), radius / Math.tan(hHalf));
    const dir = new THREE.Vector3(0, 0.8, 0.6).normalize();
    this.controls.target.set(0, 0.4, 0.25);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.maxDistance = Math.max(22, dist * 1.6);
    this.controls.update();
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMovedCamera) this.resetCamera();
  }

  private loop() {
    // rAF drives normal rendering; the interval keeps animations moving when the page
    // gets no animation frames (background tabs, embedded previews).
    const frame = () => {
      if (this.disposed) return;
      this.tickFromClock();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const iv = setInterval(() => {
      if (this.disposed) clearInterval(iv);
      else if (performance.now() - this.lastTick > 50) this.tickFromClock();
    }, 50);
  }

  private tickFromClock() {
    const now = performance.now();
    const dt = Math.min(now - this.lastTick, 1000);
    this.lastTick = now;
    this.tick(dt);
  }

  private tick(dt: number) {
    this.clock += dt;
    this.tweens.step(dt);
    this.animateHighlights();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ── State sync ───────────────────────────────────────────────────────

  setMode(mode: BoardMode) {
    this.mode = mode;
    this.select(null);
    this.renderer.domElement.style.cursor = "";
  }

  /** The moves the player may make now (play mode). */
  setMoves(moves: Move[]) {
    this.moves = moves;
    if (this.selected !== null && !this.movesFrom(this.selected).length) this.select(null);
    else this.refreshTargets();
  }

  /** Instantly place marbles to match `board`; everything else goes to the groove. */
  setBoard(board: Uint8Array) {
    this.tweens.finishAll();
    const spare: Marble[] = [];
    for (const h of HOLES) {
      const m = this.at[h];
      if (m && !board[h]) {
        spare.push(m);
        this.at[h] = null;
      }
    }
    for (const h of HOLES) {
      if (board[h] && !this.at[h]) this.at[h] = spare.pop() ?? this.groove.pop() ?? null;
    }
    const onBoard = new Set(this.at.filter(Boolean));
    this.groove = [...this.groove, ...spare].filter((m) => !onBoard.has(m));
    for (const m of this.marbles) if (!onBoard.has(m) && !this.groove.includes(m)) this.groove.push(m);
    for (const h of HOLES) this.at[h]?.mesh.position.copy(holeVec(h));
    this.groove.forEach((m, i) => m.mesh.position.copy(grooveSlot(i)));
    this.select(null);
  }

  // ── Animations ───────────────────────────────────────────────────────

  /** Animates a move; resolves when the jumping marble lands. */
  async playMove(m: Move, speed = 1): Promise<void> {
    const jumper = this.at[m.from], victim = this.at[m.over];
    if (!jumper || !victim) return;
    this.at[m.from] = null;
    this.at[m.over] = null;
    this.at[m.to] = jumper;
    this.select(null);
    const slot = this.groove.length;
    this.groove.push(victim);

    const start = jumper.mesh.position.clone(), end = holeVec(m.to);
    const lift = Math.max(0, 0.8 - (start.y - REST_Y));
    const dur = 380 / speed;
    void this.flyToGroove(victim, slot, dur * 0.45, speed);
    await this.arc(jumper, start, end, lift, dur);
    sounds.land();
  }

  /** Reverses a move; resolves when both marbles are back. */
  async undoMove(m: Move, speed = 1): Promise<void> {
    const jumper = this.at[m.to], victim = this.groove.pop();
    if (!jumper || !victim) return;
    this.at[m.to] = null;
    this.at[m.from] = jumper;
    this.at[m.over] = victim;
    this.select(null);
    const dur = 380 / speed;
    await Promise.all([
      this.arc(victim, victim.mesh.position.clone(), holeVec(m.over), 1.1, dur * 1.4),
      this.arc(jumper, jumper.mesh.position.clone(), holeVec(m.from), 0.8, dur, dur * 0.5),
    ]);
    sounds.land();
  }

  /** Pick mode: lift the starting marble out of its hole and into the groove. */
  async removeMarble(cell: Cell): Promise<void> {
    const m = this.at[cell];
    if (!m) return;
    this.at[cell] = null;
    this.groove.push(m);
    await this.flyToGroove(m, this.groove.length - 1, 0, 1);
  }

  /** Pick mode: put the starting marble back (the player chose a different hole). */
  async restoreMarble(cell: Cell): Promise<void> {
    const m = this.groove.pop();
    if (!m || this.at[cell]) return;
    this.at[cell] = m;
    await this.arc(m, m.mesh.position.clone(), holeVec(cell), 1.2, 520);
  }

  private async flyToGroove(m: Marble, slot: number, delay: number, speed: number) {
    const target = grooveSlot(slot);
    await this.arc(m, m.mesh.position.clone(), target, 1.4, 640 / speed, delay);
    sounds.groove();
  }

  private async arc(m: Marble, from: THREE.Vector3, to: THREE.Vector3, height: number, duration: number, delay = 0) {
    const dir = to.clone().sub(from);
    const axis = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
    const turns = dir.length() / MARBLE_R;
    const q0 = m.mesh.quaternion.clone();
    const spin = new THREE.Quaternion();
    this.moving.add(m);
    await this.tweens.add(duration, (raw) => {
      const k = easeInOut(raw);
      m.mesh.position.lerpVectors(from, to, k);
      m.mesh.position.y += 4 * height * raw * (1 - raw);
      if (axis.lengthSq() > 0) m.mesh.quaternion.copy(q0).premultiply(spin.setFromAxisAngle(axis, turns * k));
    }, delay);
    this.moving.delete(m);
  }

  // ── Highlights ───────────────────────────────────────────────────────

  /** Show (or clear) a suggested move. */
  setHint(m: Move | null) {
    this.hint = m;
    this.refreshTargets();
  }

  /** Coloured rings and labels around holes (solutions explorer); null clears them. */
  setHeat(cells: HeatCell[] | null) {
    for (const ring of this.rings.values()) ring.visible = false;
    for (const l of this.labels.values()) this.scene.remove(l);
    this.labels.clear();
    for (const c of cells ?? []) {
      const ring = this.rings.get(c.cell)!;
      ring.material.color.set(c.color);
      ring.material.opacity = 0.95;
      ring.visible = true;
      const label = makeLabel(c.text, c.color);
      label.position.copy(holeVec(c.cell, REST_Y + 0.62));
      this.labels.set(c.cell, label);
      this.scene.add(label);
    }
  }

  private movesFrom(cell: Cell) {
    return this.moves.filter((m) => m.from === cell);
  }

  private select(cell: Cell | null) {
    const lift = (c: Cell | null, y: number) => {
      const m = c === null ? null : this.at[c];
      if (!m || this.moving.has(m) || this.press?.dragging) return;
      const from = m.mesh.position.y;
      void this.tweens.add(110, (k) => (m.mesh.position.y = from + (y - from) * k));
    };
    if (this.selected !== cell) lift(this.selected, REST_Y);
    this.selected = cell;
    if (cell !== null && !this.press?.dragging) lift(cell, REST_Y + 0.16);
    this.refreshTargets();
  }

  private refreshTargets() {
    for (const g of this.ghosts) g.visible = false;
    for (const r of this.targetRings) r.visible = false;
    const show = (i: number, cell: Cell, color: string) => {
      const g = this.ghosts[i], r = this.targetRings[i];
      g.position.copy(holeVec(cell));
      (g.material as THREE.MeshBasicMaterial).color.set(color);
      g.visible = true;
      r.position.copy(holeVec(cell, FIELD_Y + 0.01));
      r.material.color.set(color);
      r.visible = true;
    };
    const targets = this.selected === null ? [] : this.movesFrom(this.selected).map((m) => m.to);
    targets.forEach((t, i) => show(i, t, "#a8ffd8"));
    if (this.hint && this.selected === null) show(4, this.hint.to, "#5dffa8");
    if (this.selected !== null) {
      const r = this.targetRings[5];
      r.position.copy(holeVec(this.selected, FIELD_Y + 0.01));
      r.material.color.set("#ffc04d");
      r.visible = true;
    }
  }

  private animateHighlights() {
    const pulse = 0.5 + 0.5 * Math.sin(this.clock / 180);
    for (const m of this.marbles) {
      m.mat.emissive.copy(m.baseEmissive);
      m.mat.emissiveIntensity = m.baseIntensity;
    }
    const glow = (cell: Cell | null, color: THREE.Color, k: number) => {
      const m = cell === null ? null : this.at[cell];
      if (!m) return;
      m.mat.emissive.copy(color);
      m.mat.emissiveIntensity = k;
    };
    if (this.hint && this.selected === null) glow(this.hint.from, HINT_GLOW, 0.45 + 0.5 * pulse);
    if (this.hovered !== null && this.hovered !== this.selected) glow(this.hovered, SELECT_GLOW, 0.3);
    glow(this.selected, SELECT_GLOW, 0.75 + 0.35 * pulse);
    this.targetRings[5].material.opacity = 0.75 + 0.25 * pulse;
    this.ghosts.forEach((g, i) => {
      if (!g.visible) return;
      const near = this.press?.dragging && this.dragTarget !== null && g.position.distanceTo(holeVec(this.dragTarget)) < 0.01;
      (g.material as THREE.MeshBasicMaterial).opacity = near ? 0.6 : 0.22 + 0.2 * pulse;
      this.targetRings[i].material.opacity = near ? 1 : 0.55 + 0.4 * pulse;
    });
  }

  // ── Input ────────────────────────────────────────────────────────────

  private pointer(e: PointerEvent): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private marbleUnder(e: PointerEvent): Cell | null {
    this.raycaster.setFromCamera(this.pointer(e), this.camera);
    const meshes = HOLES.map((h) => this.at[h]?.mesh).filter((m): m is THREE.Mesh => !!m);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    return HOLES.find((h) => this.at[h]?.mesh === hit.object) ?? null;
  }

  private planePoint(e: PointerEvent, y: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer(e), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p);
  }

  private holeUnder(e: PointerEvent): Cell | null {
    const p = this.planePoint(e, FIELD_Y);
    if (!p) return null;
    let best: Cell | null = null, bestD = HOLE_PICK_RADIUS;
    for (const h of HOLES) {
      const { x, z } = holeXZ(h);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) [best, bestD] = [h, d];
    }
    return best;
  }

  private bindInput() {
    const el = this.container;
    // Capture phase: runs before OrbitControls sees the event on the canvas, so a press
    // on a marble never starts a camera orbit.
    el.addEventListener("pointerdown", (e) => {
      if (this.mode !== "play" || e.button !== 0) {
        this.press = { cell: null, x: e.clientX, y: e.clientY, dragging: false, id: e.pointerId };
        return;
      }
      const cell = this.marbleUnder(e);
      this.press = { cell, x: e.clientX, y: e.clientY, dragging: false, id: e.pointerId };
      if (cell !== null) {
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
      }
    }, { capture: true });

    el.addEventListener("pointermove", (e) => {
      const p = this.press;
      if (p && p.cell !== null && p.id === e.pointerId) {
        if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP && this.movesFrom(p.cell).length) {
          p.dragging = true;
          this.select(p.cell);
          sounds.pick();
        }
        if (p.dragging) this.drag(e, p.cell);
        return;
      }
      if (!p && this.mode === "play" && e.pointerType === "mouse") {
        const cell = this.marbleUnder(e);
        this.hovered = cell !== null && this.movesFrom(cell).length ? cell : null;
        this.renderer.domElement.style.cursor = this.hovered !== null ? "grab" : "";
      }
    });

    const end = (e: PointerEvent) => {
      const p = this.press;
      if (!p || p.id !== e.pointerId) return;
      this.press = null;
      const tap = Math.hypot(e.clientX - p.x, e.clientY - p.y) <= TAP_SLOP;
      if (p.dragging && p.cell !== null) return this.drop(p.cell);
      if (!tap) return;
      if (this.mode !== "play") {
        const cell = this.marbleUnder(e) ?? this.holeUnder(e);
        if (cell !== null) this.events.onHoleClick?.(cell);
        return;
      }
      if (p.cell !== null) {
        if (this.selected === p.cell) this.select(null);
        else {
          this.select(p.cell);
          sounds.pick();
        }
        return;
      }
      const hole = this.holeUnder(e);
      const m = this.selected !== null && hole !== null ? this.movesFrom(this.selected).find((x) => x.to === hole) : undefined;
      if (m) this.events.onMove?.(m);
      else this.select(null);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", (e) => {
      if (this.press?.dragging && this.press.cell !== null) this.drop(this.press.cell, true);
      this.press = null;
      void e;
    });
  }

  private drag(e: PointerEvent, cell: Cell) {
    const m = this.at[cell];
    const p = this.planePoint(e, REST_Y + 0.45);
    if (!m || !p) return;
    m.mesh.position.copy(p);
    const near = this.movesFrom(cell)
      .map((mv) => ({ to: mv.to, d: holeVec(mv.to, p.y).distanceTo(p) }))
      .filter((x) => x.d < 0.6)
      .sort((a, b) => a.d - b.d)[0];
    this.dragTarget = near ? near.to : null;
  }

  private drop(cell: Cell, cancel = false) {
    const target = cancel ? null : this.dragTarget;
    this.dragTarget = null;
    const move = target === null ? undefined : this.movesFrom(cell).find((m) => m.to === target);
    if (move) {
      this.events.onMove?.(move);
      return;
    }
    const m = this.at[cell];
    if (m) void this.arc(m, m.mesh.position.clone(), holeVec(cell), 0, 180).then(() => sounds.land());
    this.select(null);
  }
}

function makeLabel(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(18,12,8,0.82)";
  ctx.beginPath();
  ctx.arc(64, 64, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "600 56px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(0.5, 0.5, 1);
  sprite.renderOrder = 5;
  return sprite;
}

