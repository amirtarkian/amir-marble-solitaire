// Procedural stone marbles: jade, serpentine, rose quartz, carnelian, blue calcite,
// honey calcite, lemon jade and picture jasper — the mix on the board in the photo.
// Textures are sampled from 3D noise on the sphere, so there are no seams or pinches.

import * as THREE from "three";
import { Noise, type RGB, hex, mix, smoothstep } from "./noise";

type Painter = (n: Noise, x: number, y: number, z: number) => RGB;

interface StoneKind {
  name: string;
  weight: number;
  roughness: number;
  glow?: string;
  paint: Painter;
}

const veins = (n: Noise, x: number, y: number, z: number, s: number, w: number) =>
  1 - smoothstep(0, w, Math.abs(n.fbm(x * s, y * s, z * s, 4)));

const KINDS: StoneKind[] = [
  {
    name: "jade", weight: 6, roughness: 0.2,
    paint: (n, x, y, z) => {
      const base = mix(hex("#2b4a2e"), hex("#557f4d"), n.fbm(x * 1.6, y * 1.6, z * 1.6) * 0.5 + 0.5);
      const flecks = smoothstep(0.35, 0.6, n.noise(x * 7, y * 7, z * 7));
      return mix(mix(base, hex("#86ad78"), flecks * 0.5), hex("#18301c"), veins(n, x + 3, y, z, 2.2, 0.07) * 0.7);
    },
  },
  {
    name: "serpentine", weight: 4, roughness: 0.22,
    paint: (n, x, y, z) => {
      const base = mix(hex("#9fb056"), hex("#cbd37f"), n.fbm(x * 2, y * 2, z * 2) * 0.5 + 0.5);
      const streak = 1 - smoothstep(0, 0.09, Math.abs(n.fbm(x * 1.2, y * 4.5, z * 1.2, 4)));
      return mix(base, hex("#26301a"), streak * 0.85);
    },
  },
  {
    name: "rose quartz", weight: 8, roughness: 0.18,
    paint: (n, x, y, z) => {
      const cloud = n.fbm(x * 1.4, y * 1.4, z * 1.4) * 0.5 + 0.5;
      const base = mix(hex("#d99aa9"), hex("#f3d7de"), smoothstep(0.25, 0.85, cloud));
      return mix(base, hex("#fff8f8"), veins(n, x, y + 5, z, 1.8, 0.03) * 0.5);
    },
  },
  {
    name: "carnelian", weight: 7, roughness: 0.16, glow: "#3a0b04",
    paint: (n, x, y, z) => {
      const band = Math.sin(y * 7 + n.fbm(x * 1.5, y * 1.5, z * 1.5) * 4) * 0.5 + 0.5;
      return mix(hex("#b8381f"), hex("#e8774a"), band * 0.6 + n.noise(x * 5, y * 5, z * 5) * 0.2);
    },
  },
  {
    name: "blue calcite", weight: 3, roughness: 0.25,
    paint: (n, x, y, z) => {
      const base = mix(hex("#9fb0bb"), hex("#cfd9df"), n.fbm(x * 1.8, y * 1.8, z * 1.8) * 0.5 + 0.5);
      return mix(base, hex("#f1f5f7"), veins(n, x, y, z + 2, 1.6, 0.06) * 0.8);
    },
  },
  {
    name: "honey calcite", weight: 5, roughness: 0.2,
    paint: (n, x, y, z) => {
      const swirl = n.fbm(x * 1.3 + n.noise(x * 3, y * 3, z * 3), y * 1.3, z * 1.3) * 0.5 + 0.5;
      const base = mix(hex("#efe2bd"), hex("#f6eedb"), n.noise(x * 4, y * 4, z * 4) * 0.5 + 0.5);
      return mix(base, hex("#dc9d36"), smoothstep(0.62, 0.85, swirl) * 0.8);
    },
  },
  {
    name: "lemon jade", weight: 4, roughness: 0.22,
    paint: (n, x, y, z) => {
      const m = n.fbm(x * 2.4, y * 2.4, z * 2.4) * 0.5 + 0.5;
      return mix(hex("#d9dd93"), hex("#a9b25c"), smoothstep(0.45, 0.8, m));
    },
  },
  {
    name: "picture jasper", weight: 2, roughness: 0.3,
    paint: (n, x, y, z) => {
      const band = Math.sin(y * 10 + n.fbm(x, y, z) * 6) * 0.5 + 0.5;
      return mix(hex("#a88d6c"), hex("#cdb898"), band * 0.7 + n.noise(x * 6, y * 6, z * 6) * 0.15);
    },
  },
];

function paintSphere(kind: StoneKind, seed: number, w = 192, h = 96): THREE.CanvasTexture {
  const n = new Noise(seed);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const off = (seed % 97) * 0.37;
  for (let j = 0; j < h; j++) {
    const phi = ((j + 0.5) / h) * Math.PI;
    for (let i = 0; i < w; i++) {
      const theta = ((i + 0.5) / w) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta) + off, y = Math.cos(phi), z = Math.sin(phi) * Math.sin(theta);
      const c = kind.paint(n, x, y, z);
      const k = (j * w + i) * 4;
      img.data[k] = c[0];
      img.data[k + 1] = c[1];
      img.data[k + 2] = c[2];
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** `count` stone materials with the photo's mix of kinds, two texture variants per kind. */
export function stoneMaterials(count: number, seed = 11): THREE.MeshPhysicalMaterial[] {
  const variants = KINDS.map((kind, k) =>
    [0, 1].map((v) =>
      new THREE.MeshPhysicalMaterial({
        map: paintSphere(kind, seed * 31 + k * 7 + v),
        roughness: kind.roughness,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        emissive: new THREE.Color(kind.glow ?? "#000000"),
        emissiveIntensity: kind.glow ? 0.6 : 0,
      }),
    ),
  );
  const totalWeight = KINDS.reduce((s, k) => s + k.weight, 0);
  let s = seed;
  const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
  return Array.from({ length: count }, () => {
    let r = rand() * totalWeight;
    const k = KINDS.findIndex((kind) => (r -= kind.weight) < 0);
    return variants[k < 0 ? 0 : k][rand() < 0.5 ? 0 : 1];
  });
}
