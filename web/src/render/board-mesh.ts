// The walnut board: a lathed rim with a groove for captured marbles, and a play field
// with 37 real dimples. Dimensions are in hole spacings.

import * as THREE from "three";
import { HOLES, holeXZ } from "../board/geometry";
import { walnutTextures } from "./textures";

export const FIELD_Y = 0.6;
export const FIELD_R = 3.85;
export const MARBLE_R = 0.34;
const DIMPLE_R = 0.36;
const DIMPLE_DEPTH = 0.13;
const GROOVE_C = 4.38; // groove centre radius
const GROOVE_R = 0.4;
const GROOVE_Y = 0.66; // groove arc centre height
const TEX_SPAN = 11; // board-plane units covered by the wood texture

/** Height of a marble's centre when resting in a hole. */
export const REST_Y = FIELD_Y - DIMPLE_DEPTH * 0.55 + MARBLE_R;
/** Height of a marble's centre when lying in the groove. */
export const GROOVE_REST_Y = GROOVE_Y - GROOVE_R + MARBLE_R;
/** Angular spacing of captured marbles around the groove. */
const SLOT_ANGLE = (2 * MARBLE_R + 0.03) / GROOVE_C;

export function grooveSlot(i: number): THREE.Vector3 {
  const a = -Math.PI / 2 - 0.35 + i * SLOT_ANGLE;
  return new THREE.Vector3(Math.cos(a) * GROOVE_C, GROOVE_REST_Y, Math.sin(a) * GROOVE_C);
}

function planarUVs(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / TEX_SPAN + 0.5;
    uv[i * 2 + 1] = pos.getZ(i) / TEX_SPAN + 0.5;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

function rimGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [
    [0, 0], [4.98, 0], [5.1, 0.08], [5.14, 0.5], [5.08, 0.66], [4.96, 0.72], [4.84, 0.72], [4.79, 0.68],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  for (let k = 0; k <= 24; k++) {
    const a = (k / 24) * Math.PI;
    pts.push(new THREE.Vector2(GROOVE_C + GROOVE_R * Math.cos(a), GROOVE_Y - GROOVE_R * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(3.94, 0.63), new THREE.Vector2(FIELD_R, FIELD_Y));
  const geo = new THREE.LatheGeometry(pts, 192);
  planarUVs(geo);
  return geo;
}

function dimpleDepth(x: number, z: number, centres: { x: number; z: number }[]): number {
  for (const c of centres) {
    const d2 = ((x - c.x) ** 2 + (z - c.z) ** 2) / (DIMPLE_R * DIMPLE_R);
    if (d2 < 1) return DIMPLE_DEPTH * (1 - d2) * (1 - d2);
  }
  return 0;
}

function fieldGeometry(segments = 240): THREE.BufferGeometry {
  const centres = HOLES.map(holeXZ);
  const n = segments + 1;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let x = (i / segments - 0.5) * 2 * FIELD_R, z = (j / segments - 0.5) * 2 * FIELD_R;
      const r = Math.hypot(x, z);
      if (r > FIELD_R) {
        x *= FIELD_R / r; // fold the square grid onto the circle's edge
        z *= FIELD_R / r;
      }
      const k = (j * n + i) * 3;
      pos[k] = x;
      pos[k + 1] = FIELD_Y - dimpleDepth(x, z, centres);
      pos[k + 2] = z;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Darken the dimples a little, like the shading inside a real routed hole.
  const col = new Float32Array(n * n * 3);
  for (let v = 0; v < n * n; v++) {
    const shade = 1 - ((FIELD_Y - pos[v * 3 + 1]) / DIMPLE_DEPTH) * 0.45;
    col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = shade;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  planarUVs(geo);
  geo.computeVertexNormals();
  return geo;
}

export function buildBoard(): THREE.Group {
  const { map, roughness } = walnutTextures();
  const wood = new THREE.MeshPhysicalMaterial({
    map,
    roughnessMap: roughness,
    roughness: 1,
    clearcoat: 0.55,
    clearcoatRoughness: 0.32,
  });
  const group = new THREE.Group();
  const field = wood.clone();
  field.vertexColors = true;
  for (const [geo, mat] of [[rimGeometry(), wood], [fieldGeometry(), field]] as const) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
